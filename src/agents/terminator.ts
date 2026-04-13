import type { CopilotClient } from "@github/copilot-sdk";
import { approveAll } from "@github/copilot-sdk";
import { attachLogger } from "../utils/logger.js";
import { readFileOrDefault } from "../utils/files.js";
import { DEFAULT_TIMEOUT } from "../types.js";
import { loadPrompt } from "../utils/prompt.js";
import { createGatekeeperTool } from "../tools/decisions.js";
import type { AgentConfig, Validator, GatekeeperResult, EvalOrchestratorResult, EvaluatorResult, EvalResults } from "../types.js";
import { Gate, type Rule } from "../rules.js";
import type { IterationRecord } from "../utils/state.js";
import { withSession } from "../utils/session.js";

// ── Terminator Context ──────────────────────────────────────

export interface TerminatorContext {
    results: EvalResults;
    history: IterationRecord[];
    iteration: number;
}

export interface AgenticTerminatorInput {
    evalResult: EvalOrchestratorResult;
    history: IterationRecord[];
}

// ── Terminator Rules (propositional logic) ──────────────────

const allScoresAbove = (threshold: number): Rule<TerminatorContext> =>
    Gate.lift((ctx) => {
        for (const [name, r] of ctx.results) {
            if (name !== "symbolic" && r.score < threshold) return "FAILURE";
        }
        return "SUCCESS";
    });

const scoresDecreasing: Rule<TerminatorContext> = Gate.lift((ctx) => {
    if (ctx.history.length < 2) return "FAILURE";
    const recent = ctx.history.slice(-2);
    const prev = recent[0]!.scores;
    const curr = recent[1]!.scores;
    if (!prev || !curr) return "CONTINUE";
    const declining = curr.features < prev.features && curr.reliability < prev.reliability && curr.modularity < prev.modularity;
    return Gate.fromBool(declining);
});

const scoresPlateau: Rule<TerminatorContext> = Gate.lift((ctx) => {
    if (ctx.history.length < 3) return "FAILURE";
    const recent = ctx.history.slice(-3);
    const scores = recent.map(r => r.scores).filter(Boolean);
    if (scores.length < 3) return "CONTINUE";
    const maxes = scores.map(s => Math.max(s!.features, s!.reliability, s!.modularity));
    const spread = Math.max(...maxes) - Math.min(...maxes);
    return Gate.fromBool(spread < 5);
});

const earlyIteration: Rule<TerminatorContext> = Gate.lift((ctx) =>
    Gate.fromBool(ctx.iteration <= 2));

/**
 * Terminator convergence rules:
 * SUCCESS = STOP (goal achieved or diverged/plateaued)
 * FAILURE = CONTINUE (more work needed)
 * CONTINUE = defer to agentic terminator
 */
const terminatorRule: Rule<TerminatorContext> = Gate.or(
    allScoresAbove(90),
    scoresDecreasing,
    scoresPlateau,
);

// ── Terminator Validator (rule-based) ───────────────────────

class TerminatorValidator implements Validator<TerminatorContext> {
    name = "validator:terminator";

    rule(): Rule<TerminatorContext> {
        return terminatorRule;
    }

    async run(_client: CopilotClient, _config: AgentConfig, ctx: TerminatorContext): Promise<GatekeeperResult> {
        // Early iteration guard — never terminate in first 2 iterations
        if (await earlyIteration(ctx) === "SUCCESS") {
            return { result: "CONTINUE", feedback: `Iteration ${ctx.iteration} ≤ 2 — too early to stop` };
        }

        const result = await this.rule()(ctx);

        if (result === "SUCCESS") {
            if (await allScoresAbove(90)(ctx) === "SUCCESS") return { result: "SUCCESS", feedback: "All scores ≥ 90 — goal achieved" };
            if (await scoresDecreasing(ctx) === "SUCCESS") return { result: "SUCCESS", feedback: "Scores decreasing — divergence detected" };
            if (await scoresPlateau(ctx) === "SUCCESS") return { result: "SUCCESS", feedback: "Score plateau — diminishing returns" };
        }

        return { result: "CONTINUE", feedback: "No termination condition met" };
    }
}

// ── Agentic Terminator (LLM-backed Validator) ───────────────

class AgenticTerminator implements Validator<AgenticTerminatorInput> {
    name = "validator:agentic-terminator";

    rule(): Rule<AgenticTerminatorInput> {
        // The agentic terminator's rule delegates to the LLM at evaluation time.
        // The CopilotClient is not available here — use run() directly for full execution.
        return Gate.defer<AgenticTerminatorInput>();
    }

    async run(client: CopilotClient, config: AgentConfig, input: AgenticTerminatorInput): Promise<GatekeeperResult> {
        const { tool, getResult } = createGatekeeperTool();

        return withSession(client, {
            workingDirectory: process.cwd(),
            model: config.model,
            reasoningEffort: config.reasoningEffort ?? "high",
            systemMessage: { mode: "replace", content: loadPrompt("terminator", { CWD: process.cwd() }) },
            tools: [tool],
            onPermissionRequest: approveAll,
            infiniteSessions: { enabled: false },
            streaming: true,
        }, async (session) => {
            attachLogger(session, this.name);

            const termGoal = readFileOrDefault(".descend/terminator/goal.md", "No terminator goal found.");
            const evalReport = readFileOrDefault(".descend/evaluator/report.md", "No evaluator report found.");

            const structuredSection = (() => {
                const lines = [
                    "", "## Structured Evaluation Data",
                    `- **Decision**: ${input.evalResult.decision}`,
                    `- **Overall score**: ${input.evalResult.score}/100`,
                ];
                for (const [name, result] of input.evalResult.axes) {
                    lines.push(`- **${name}**: ${result.score}/100 — ${result.feedback || "no issues"}`);
                }
                lines.push("", "## Score History",
                    ...input.history.map(h => {
                        const s = h.scores ? `features=${h.scores.features}, reliability=${h.scores.reliability}, modularity=${h.scores.modularity}` : "n/a";
                        return `- Iteration ${h.iteration}: ${h.decision} (${s})`;
                    }),
                );
                return lines;
            })();

            await session.sendAndWait({
                prompt: [
                    "## Terminator Goal (your criteria)", termGoal, "",
                    "## Evaluator Report (prose)", evalReport,
                    ...structuredSection, "",
                    "Decide: SUCCESS (goal achieved), FAILURE (diverged/unrecoverable), or CONTINUE (more work needed).",
                    "Call the make_decision tool with your verdict.",
                ].join("\n"),
            }, config.timeout ?? DEFAULT_TIMEOUT);

            const result = getResult();
            if (!result) throw new Error("Agentic terminator did not call make_decision tool");
            return result;
        });
    }
}

// ── Exports ─────────────────────────────────────────────────

export const terminatorValidator = new TerminatorValidator();
export const agenticTerminator = new AgenticTerminator();
