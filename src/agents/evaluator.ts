import type { CopilotClient } from "@github/copilot-sdk";
import { approveAll } from "@github/copilot-sdk";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import {
    createEvaluatorDecisionTool,
    type EvaluatorDecision,
} from "../tools/decisions.js";
import { EVALUATOR_PROMPT } from "../prompts/evaluator.js";
import { attachLogger } from "../utils/logger.js";
import { getGitDiff } from "../utils/git.js";

function readFileOrDefault(path: string, fallback: string): string {
    try {
        return readFileSync(path, "utf-8");
    } catch {
        return fallback;
    }
}

function readDirContents(dirPath: string): string {
    if (!existsSync(dirPath)) return "(empty)";
    const files = readdirSync(dirPath).filter((f) => f.endsWith(".md"));
    if (files.length === 0) return "(empty)";
    return files
        .map((f) => {
            const content = readFileSync(join(dirPath, f), "utf-8");
            return `### ${f}\n\n${content}`;
        })
        .join("\n\n---\n\n");
}

export interface EvaluatorContext {
    model: string;
}

export async function runEvaluator(
    client: CopilotClient,
    ctx: EvaluatorContext,
): Promise<EvaluatorDecision> {
    const { tool, getResult } = createEvaluatorDecisionTool();

    const session = await client.createSession({
        model: ctx.model,
        systemMessage: { mode: "replace", content: EVALUATOR_PROMPT },
        tools: [tool],
        onPermissionRequest: approveAll,
        infiniteSessions: { enabled: false },
        streaming: true,
    });
    attachLogger(session, "evaluator");

    const gitDiff = getGitDiff();
    const evalGoal = readFileOrDefault(
        ".descend/evaluator/goal.md",
        "No evaluator goal found.",
    );
    const implReport = readFileOrDefault(
        ".descend/implementor/report.md",
        "No implementor report found.",
    );
    const researchNotes = readDirContents(".descend/research");
    const planNotes = readDirContents(".descend/plan");

    await session.sendAndWait({
        prompt: [
            "## Evaluator Goal (your criteria)",
            evalGoal,
            "",
            "## Git Diff (code changes to review)",
            "```diff",
            gitDiff || "(no changes)",
            "```",
            "",
            "## Implementor Execution Log",
            implReport,
            "",
            "## Implementor Research Notes",
            researchNotes,
            "",
            "## Implementor Plan",
            planNotes,
            "",
            "Evaluate the work. Write your report to .descend/evaluator/report.md.",
            "Then call the submit_decision tool with your verdict (approve or reject).",
        ].join("\n"),
    });

    await session.disconnect();
    await client.deleteSession(session.sessionId);

    const result = getResult();
    if (!result) {
        throw new Error("Evaluator did not call submit_decision tool");
    }
    return result;
}
