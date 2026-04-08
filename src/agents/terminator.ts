import type { CopilotClient } from "@github/copilot-sdk";
import { approveAll } from "@github/copilot-sdk";
import { readFileSync } from "fs";
import {
    createTerminatorDecisionTool,
    type TerminatorDecision,
} from "../tools/decisions.js";
import { TERMINATOR_PROMPT } from "../prompts/terminator.js";
import { attachLogger } from "../utils/logger.js";

function readFileOrDefault(path: string, fallback: string): string {
    try {
        return readFileSync(path, "utf-8");
    } catch {
        return fallback;
    }
}

export interface TerminatorContext {
    model: string;
}

export async function runTerminator(
    client: CopilotClient,
    ctx: TerminatorContext,
): Promise<TerminatorDecision> {
    const { tool, getResult } = createTerminatorDecisionTool();

    const session = await client.createSession({
        model: ctx.model,
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

    await session.sendAndWait({
        prompt: [
            "## Terminator Goal (your criteria)",
            termGoal,
            "",
            "## Evaluator Report",
            evalReport,
            "",
            "Decide: should the loop CONTINUE or STOP?",
            "Call the make_decision tool with your verdict.",
        ].join("\n"),
    });

    await session.disconnect();
    await client.deleteSession(session.sessionId);

    const result = getResult();
    if (!result) {
        throw new Error("Terminator did not call make_decision tool");
    }
    return result;
}
