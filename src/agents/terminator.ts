import type { CopilotClient } from "@github/copilot-sdk";
import { approveAll } from "@github/copilot-sdk";
import {
    createTerminatorDecisionTool,
    type TerminatorDecision,
} from "../tools/decisions.js";
import { TERMINATOR_PROMPT } from "../prompts/terminator.js";
import { attachLogger } from "../utils/logger.js";
import { readFileOrDefault } from "../utils/files.js";

import type { EvaluatorDecision } from "../tools/decisions.js";
import type { IterationRecord } from "../utils/state.js";

export interface TerminatorContext {
    model: string;
    reasoningEffort?: "low" | "medium" | "high" | "xhigh";
    timeout?: number;
}

export interface TerminatorInput {
    evalDecision: EvaluatorDecision;
    history: IterationRecord[];
}

export async function runTerminator(
    client: CopilotClient,
    ctx: TerminatorContext,
    input?: TerminatorInput,
): Promise<TerminatorDecision> {
    const { tool, getResult } = createTerminatorDecisionTool();

    const session = await client.createSession({
        model: ctx.model,
        reasoningEffort: ctx.reasoningEffort ?? "high",
        systemMessage: { mode: "replace", content: TERMINATOR_PROMPT },
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

    // Build structured context for the terminator
    const structuredSection = input ? [
        "",
        "## Structured Evaluation Data",
        `- **Decision**: ${input.evalDecision.decision}`,
        `- **Scores**: features=${input.evalDecision.scores.features}, reliability=${input.evalDecision.scores.reliability}, modularity=${input.evalDecision.scores.modularity}`,
        `- **Tests**: ${input.evalDecision.testsStatus}`,
        `- **Feature issues**: ${input.evalDecision.issues.features.length === 0 ? "none" : input.evalDecision.issues.features.map(i => `\n  - ${i}`).join("")}`,
        `- **Reliability issues**: ${input.evalDecision.issues.reliability.length === 0 ? "none" : input.evalDecision.issues.reliability.map(i => `\n  - ${i}`).join("")}`,
        `- **Modularity issues**: ${input.evalDecision.issues.modularity.length === 0 ? "none" : input.evalDecision.issues.modularity.map(i => `\n  - ${i}`).join("")}`,
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
            "Decide: should the loop CONTINUE or STOP?",
            "Call the make_decision tool with your verdict.",
        ].join("\n"),
    }, ctx.timeout);

    await session.disconnect();
    await client.deleteSession(session.sessionId);

    const result = getResult();
    if (!result) {
        throw new Error("Terminator did not call make_decision tool");
    }
    return result;
}
