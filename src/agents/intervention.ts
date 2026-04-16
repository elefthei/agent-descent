import type { CopilotClient } from "@github/copilot-sdk";
import { approveAll, defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import type { AgentConfig, Validator, GatekeeperResult } from "../types.js";
import { DEFAULT_TIMEOUT } from "../types.js";
import { Gate, type Rule, type Tri } from "../rules.js";
import type { IterationRecord } from "../utils/state.js";
import { attachLogger } from "../utils/logger.js";
import { loadPrompt } from "../utils/prompt.js";
import { withSession } from "../utils/session.js";

// ── Intervention Context ────────────────────────────────────

export interface InterventionContext {
    history: IterationRecord[];
    window: number;
    gitLog: string;
}

export interface InterventionResult extends GatekeeperResult {
    revertTo?: string;
}

// ── Intervention Rules ──────────────────────────────────────

/** N consecutive errors (system crashes, ENOBUFS, etc.) */
const consecutiveErrors: Rule<InterventionContext> = Gate.lift((ctx) => {
    const recent = ctx.history.slice(-ctx.window);
    if (recent.length < ctx.window) return "CONTINUE";
    return Gate.fromBool(recent.every(r => r.decision === "error"));
});

/** Build broken for N iterations (score=0 on any axis for N straight) */
const persistentBuildFailure: Rule<InterventionContext> = Gate.lift((ctx) => {
    const recent = ctx.history.slice(-ctx.window);
    if (recent.length < ctx.window) return "CONTINUE";
    return Gate.fromBool(recent.every(r =>
        r.scores != null && (r.scores.features === 0 || r.scores.reliability === 0)));
});

/** Monotonic decline across N iterations on ALL axes */
const allAxesDeclining: Rule<InterventionContext> = Gate.lift((ctx) => {
    const recent = ctx.history.slice(-ctx.window);
    if (recent.length < ctx.window) return "CONTINUE";
    const scores = recent.map(r => r.scores).filter((s): s is NonNullable<typeof s> => s != null);
    if (scores.length < ctx.window) return "CONTINUE";
    for (let i = 1; i < scores.length; i++) {
        if (scores[i]!.features >= scores[i - 1]!.features ||
            scores[i]!.reliability >= scores[i - 1]!.reliability ||
            scores[i]!.modularity >= scores[i - 1]!.modularity) {
            return "FAILURE";
        }
    }
    return "SUCCESS";
});

const interventionRule: Rule<InterventionContext> = Gate.or(
    consecutiveErrors,
    persistentBuildFailure,
    allAxesDeclining,
);

// ── Intervention Validator ──────────────────────────────────

function createInterventionTool() {
    const box = { result: null as InterventionResult | null };

    const tool = defineTool("submit_intervention", {
        description: "Submit your intervention decision. If intervening, specify which git commit SHA to revert to.",
        parameters: z.object({
            result: z
                .enum(["SUCCESS", "FAILURE", "CONTINUE"])
                .describe("SUCCESS=intervene now, FAILURE=no cascade detected, CONTINUE=ambiguous"),
            feedback: z
                .string()
                .describe("Explanation of your decision"),
            revertTo: z
                .string()
                .optional()
                .describe("Git commit SHA to revert to (required if result=SUCCESS)"),
        }),
        skipPermission: true,
        handler: async (params: { result: Tri; feedback: string; revertTo?: string }) => {
            box.result = params;
            return `Intervention decision: ${params.result}`;
        },
    });

    return { tool, getResult: () => box.result };
}

class InterventionValidator implements Validator<InterventionContext> {
    name = "validator:intervention";

    rule(): Rule<InterventionContext> {
        return interventionRule;
    }

    async run(client: CopilotClient, config: AgentConfig, ctx: InterventionContext): Promise<InterventionResult> {
        // Phase 1: Rule-based check
        const ruleResult = await this.rule()(ctx);

        if (ruleResult === "FAILURE") {
            return { result: "FAILURE", feedback: "No cascading failure pattern detected" };
        }

        // Phase 2: If rules say SUCCESS, identify which pattern and get revert point from LLM
        // If rules say CONTINUE (ambiguous), let LLM decide everything
        const ruleReason = ruleResult === "SUCCESS"
            ? await identifyRuleTrigger(ctx)
            : "Ambiguous — requesting LLM analysis";

        // LLM agent picks revert point and confirms/overrides
        const { tool, getResult } = createInterventionTool();

        return withSession(client, {
            workingDirectory: process.cwd(),
            model: config.model,
            reasoningEffort: config.reasoningEffort ?? "high",
            systemMessage: { mode: "replace", content: loadPrompt("intervention", { CWD: process.cwd() }) },
            tools: [tool],
            onPermissionRequest: approveAll,
            infiniteSessions: { enabled: false },
            streaming: true,
        }, async (session) => {
            attachLogger(session, this.name);

            const historySection = ctx.history.map(h => {
                const s = h.scores ? `features=${h.scores.features}, reliability=${h.scores.reliability}, modularity=${h.scores.modularity}` : "no scores";
                return `- Iteration ${h.iteration}: ${h.decision} (${s}) — ${h.summary.slice(0, 200)}`;
            }).join("\n");

            await session.sendAndWait({
                prompt: [
                    `## Rule-Based Analysis`,
                    `Detection: ${ruleReason}`,
                    "",
                    "## Iteration History (last N)",
                    historySection,
                    "",
                    "## Git Log",
                    ctx.gitLog,
                    "",
                    "Decide whether to intervene. If intervening, specify which git commit SHA to revert to.",
                    "Call submit_intervention with your decision.",
                ].join("\n"),
            }, config.timeout ?? DEFAULT_TIMEOUT);

            const result = getResult();
            if (!result) throw new Error("Intervention agent did not call submit_intervention");
            return result;
        });
    }
}

async function identifyRuleTrigger(ctx: InterventionContext): Promise<string> {
    if (await consecutiveErrors(ctx) === "SUCCESS") return `${ctx.window} consecutive errors — system crash pattern`;
    if (await persistentBuildFailure(ctx) === "SUCCESS") return `Build broken for ${ctx.window} iterations (zero scores)`;
    if (await allAxesDeclining(ctx) === "SUCCESS") return `All axes declining for ${ctx.window} iterations`;
    return "Cascading failure pattern detected";
}

// ── Exports ─────────────────────────────────────────────────

export const interventionValidator = new InterventionValidator();
