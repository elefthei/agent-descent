import type { CopilotClient } from "@github/copilot-sdk";
import { approveAll } from "@github/copilot-sdk";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { IMPLEMENTOR_RESEARCH_PROMPT } from "../prompts/implementor-research.js";
import { IMPLEMENTOR_PLAN_PROMPT } from "../prompts/implementor-plan.js";
import { IMPLEMENTOR_EXEC_PROMPT } from "../prompts/implementor-exec.js";
import { attachLogger } from "../utils/logger.js";

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

export interface ImplementorContext {
    model: string;
}

export async function runImplementorResearch(
    client: CopilotClient,
    ctx: ImplementorContext,
): Promise<void> {
    const goalFile = readFileOrDefault(
        ".descend/implementor/goal.md",
        "No goal file found.",
    );
    const evaluatorReport = readFileOrDefault(
        ".descend/evaluator/report.md",
        "No previous evaluator report.",
    );

    const session = await client.createSession({
        model: ctx.model,
        systemMessage: { mode: "replace", content: IMPLEMENTOR_RESEARCH_PROMPT },
        onPermissionRequest: approveAll,
        infiniteSessions: { enabled: false },
        streaming: true,
    });
    attachLogger(session, "implementor:research");

    await session.sendAndWait({
        prompt: [
            "## Goal",
            goalFile,
            "",
            "## Previous Evaluator Report",
            evaluatorReport,
            "",
            "Research what is needed to address the goal and evaluator feedback.",
            "Save structured notes to .descend/research/ as markdown files.",
        ].join("\n"),
    });

    await session.disconnect();
    await client.deleteSession(session.sessionId);
}

export async function runImplementorPlan(
    client: CopilotClient,
    ctx: ImplementorContext,
): Promise<void> {
    const goalFile = readFileOrDefault(
        ".descend/implementor/goal.md",
        "No goal file found.",
    );
    const evaluatorReport = readFileOrDefault(
        ".descend/evaluator/report.md",
        "No previous evaluator report.",
    );
    const researchNotes = readDirContents(".descend/research");

    const session = await client.createSession({
        model: ctx.model,
        systemMessage: { mode: "replace", content: IMPLEMENTOR_PLAN_PROMPT },
        onPermissionRequest: approveAll,
        infiniteSessions: { enabled: false },
        streaming: true,
    });
    attachLogger(session, "implementor:plan");

    await session.sendAndWait({
        prompt: [
            "## Goal",
            goalFile,
            "",
            "## Previous Evaluator Report",
            evaluatorReport,
            "",
            "## Research Notes",
            researchNotes,
            "",
            "Create a detailed attack plan in .descend/plan/ as a markdown file.",
        ].join("\n"),
    });

    await session.disconnect();
    await client.deleteSession(session.sessionId);
}

export async function runImplementorExec(
    client: CopilotClient,
    ctx: ImplementorContext,
): Promise<void> {
    const goalFile = readFileOrDefault(
        ".descend/implementor/goal.md",
        "No goal file found.",
    );
    const planNotes = readDirContents(".descend/plan");

    const session = await client.createSession({
        model: ctx.model,
        systemMessage: { mode: "replace", content: IMPLEMENTOR_EXEC_PROMPT },
        onPermissionRequest: approveAll,
        infiniteSessions: { enabled: false },
        streaming: true,
    });
    attachLogger(session, "implementor:exec");

    await session.sendAndWait({
        prompt: [
            "## Goal",
            goalFile,
            "",
            "## Plan",
            planNotes,
            "",
            "Execute the plan. Make code changes.",
            "Write an execution log to .descend/implementor/report.md when done.",
        ].join("\n"),
    });

    await session.disconnect();
    await client.deleteSession(session.sessionId);
}
