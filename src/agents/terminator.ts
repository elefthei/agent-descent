import type { CopilotClient } from "@github/copilot-sdk";
import { approveAll, defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { attachLogger } from "../utils/logger.js";
import { readFileOrDefault } from "../utils/files.js";
import { DEFAULT_TIMEOUT } from "../types.js";
import { loadPrompt } from "../utils/prompt.js";
import type { AgentConfig, GatekeeperResult, EvaluatorResult } from "../types.js";
import type { Tri } from "../rules.js";
import type { EvaluatorDecision } from "../tools/decisions.js";
import type { IterationRecord } from "../utils/state.js";

export interface TerminatorInput {
    evalDecision: EvaluatorDecision;
    history: IterationRecord[];
}

function createGatekeeperTool() {
    const box = { result: null as GatekeeperResult | null };

    const tool = defineTool("make_decision", {
        description: "Submit your convergence decision: SUCCESS (stop, goal achieved), FAILURE (stop, diverged/unrecoverable), or CONTINUE (keep iterating).",
        parameters: z.object({
            result: z
                .enum(["SUCCESS", "FAILURE", "CONTINUE"])
                .describe("SUCCESS=goal achieved, FAILURE=diverged/unrecoverable, CONTINUE=more work needed"),
            feedback: z
                .string()
                .describe("Brief explanation of your decision"),
        }),
        skipPermission: true,
        handler: async (params: { result: Tri; feedback: string }) => {
            box.result = params;
            return `Decision recorded: ${params.result}`;
        },
    });

    return { tool, getResult: () => box.result };
}

export async function runTerminator(
    client: CopilotClient,
    ctx: AgentConfig,
    input?: TerminatorInput,
): Promise<GatekeeperResult> {
    const { tool, getResult } = createGatekeeperTool();

    const session = await client.createSession({
        workingDirectory: process.cwd(),
        model: ctx.model,
        reasoningEffort: ctx.reasoningEffort ?? "high",
        systemMessage: { mode: "replace", content: loadPrompt("terminator", { CWD: process.cwd() }) },
        tools: [tool],
        onPermissionRequest: approveAll,
        infiniteSessions: { enabled: false },
        streaming: true,
    });
    attachLogger(session, "terminator");

    const termGoal = readFileOrDefault(
        ".descend/terminator/goal.md",
        "No terminator goal found.",
    );
    const evalReport = readFileOrDefault(
        ".descend/evaluator/report.md",
        "No evaluator report found.",
    );

    const structuredSection = input ? [
        "",
        "## Structured Evaluation Data",
        `- **Decision**: ${input.evalDecision.decision}`,
        `- **Scores**: features=${input.evalDecision.scores.features}, reliability=${input.evalDecision.scores.reliability}, modularity=${input.evalDecision.scores.modularity}`,
        `- **Remaining work**: ${input.evalDecision.remainingWork.length === 0 ? "none" : input.evalDecision.remainingWork.map(i => `\n  - ${i}`).join("")}`,
        "",
        "## Score History",
        ...input.history.map(h => {
            const s = h.scores ? `features=${h.scores.features}, reliability=${h.scores.reliability}, modularity=${h.scores.modularity}` : "n/a";
            return `- Iteration ${h.iteration}: ${h.decision} (${s})`;
        }),
    ] : [];

    await session.sendAndWait({
        prompt: [
            "## Terminator Goal (your criteria)",
            termGoal,
            "",
            "## Evaluator Report (prose)",
            evalReport,
            ...structuredSection,
            "",
            "Decide: SUCCESS (goal achieved), FAILURE (diverged/unrecoverable), or CONTINUE (more work needed).",
            "Call the make_decision tool with your verdict.",
        ].join("\n"),
    }, ctx.timeout ?? DEFAULT_TIMEOUT);

    await session.disconnect();
    await client.deleteSession(session.sessionId);

    const result = getResult();
    if (!result) {
        throw new Error("Terminator did not call make_decision tool");
    }
    return result;
}
