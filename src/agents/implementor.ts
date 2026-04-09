import type { CopilotClient } from "@github/copilot-sdk";
import { approveAll } from "@github/copilot-sdk";
import { attachLogger } from "../utils/logger.js";
import { readFileOrDefault, readDirContents } from "../utils/files.js";
import { DEFAULT_TIMEOUT } from "../types.js";
import { loadPrompt } from "../utils/prompt.js";

import type { AgentConfig } from "../types.js";

export async function runImplementorResearch(
    client: CopilotClient,
    ctx: AgentConfig,
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
        workingDirectory: process.cwd(),
        model: ctx.model,
        reasoningEffort: ctx.reasoningEffort ?? "high",
        systemMessage: { mode: "replace", content: loadPrompt("implementor-research") },
        onPermissionRequest: approveAll,
        infiniteSessions: { enabled: false },
        streaming: true,
    });
    attachLogger(session, "implementor:research");

    await session.sendAndWait({
        prompt: [
            `## Working Directory: ${process.cwd()}`,
            "Use absolute paths for all file operations.",
            "",
            "## Goal",
            goalFile,
            "",
            "## Previous Evaluator Report",
            evaluatorReport,
            "",
            "Research what is needed to address the goal and evaluator feedback.",
            "Save structured notes to .descend/research/ as markdown files.",
        ].join("\n"),
    }, ctx.timeout ?? DEFAULT_TIMEOUT);

    await session.disconnect();
    await client.deleteSession(session.sessionId);
}

export async function runImplementorPlan(
    client: CopilotClient,
    ctx: AgentConfig,
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
        workingDirectory: process.cwd(),
        model: ctx.model,
        reasoningEffort: ctx.reasoningEffort ?? "high",
        systemMessage: { mode: "replace", content: loadPrompt("implementor-plan") },
        onPermissionRequest: approveAll,
        infiniteSessions: { enabled: false },
        streaming: true,
    });
    attachLogger(session, "implementor:plan");

    await session.sendAndWait({
        prompt: [
            `## Working Directory: ${process.cwd()}`,
            "Use absolute paths for all file operations.",
            "",
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
    }, ctx.timeout ?? DEFAULT_TIMEOUT);

    await session.disconnect();
    await client.deleteSession(session.sessionId);
}

export async function runImplementorExec(
    client: CopilotClient,
    ctx: AgentConfig,
): Promise<void> {
    const goalFile = readFileOrDefault(
        ".descend/implementor/goal.md",
        "No goal file found.",
    );
    const planNotes = readDirContents(".descend/plan");

    const session = await client.createSession({
        workingDirectory: process.cwd(),
        model: ctx.model,
        reasoningEffort: ctx.reasoningEffort ?? "high",
        systemMessage: { mode: "replace", content: loadPrompt("implementor-exec") },
        onPermissionRequest: approveAll,
        infiniteSessions: { enabled: false },
        streaming: true,
    });
    attachLogger(session, "implementor:exec");

    await session.sendAndWait({
        prompt: [
            `## Working Directory: ${process.cwd()}`,
            "Use absolute paths for all file operations.",
            "",
            "## Goal",
            goalFile,
            "",
            "## Plan",
            planNotes,
            "",
            "Execute the plan. Make code changes.",
            "Write an execution log to .descend/implementor/report.md when done.",
        ].join("\n"),
    }, ctx.timeout ?? DEFAULT_TIMEOUT);

    await session.disconnect();
    await client.deleteSession(session.sessionId);
}
