import type { CopilotClient } from "@github/copilot-sdk";
import { approveAll } from "@github/copilot-sdk";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import type { AgentConfig } from "../types.js";
import { DEFAULT_TIMEOUT } from "../types.js";
import { gitCommitDescendOnly } from "../utils/git.js";
import { attachLogger, log } from "../utils/logger.js";
import { loadPrompt } from "../utils/prompt.js";

export async function runSetup(
    client: CopilotClient,
    config: AgentConfig,
    goalPath: string,
): Promise<void> {
    log.setup("🎯 Reading goal.md and projecting per-agent goals...");

    mkdirSync(".descend/implementor", { recursive: true });
    mkdirSync(".descend/evaluator", { recursive: true });
    mkdirSync(".descend/terminator", { recursive: true });

    const goalContent = readFileSync(goalPath, "utf-8");

    const session = await client.createSession({
        model: config.model,
        reasoningEffort: config.reasoningEffort ?? "high",
        systemMessage: { mode: "replace", content: loadPrompt("setup") },
        onPermissionRequest: approveAll,
        infiniteSessions: { enabled: false },
        streaming: true,
    });
    attachLogger(session, "setup");

    await session.sendAndWait({
        prompt: [
            "## Goal File Contents",
            "",
            goalContent,
            "",
            "Project this into the three goal files now.",
        ].join("\n"),
    }, config.timeout ?? DEFAULT_TIMEOUT);

    await session.disconnect();
    await client.deleteSession(session.sessionId);

    log.setup("✅ Goal files projected:");
    log.setup("   .descend/implementor/goal.md");
    log.setup("   .descend/evaluator/goal.md");
    log.setup("   .descend/terminator/goal.md");

    // Seed initial evaluator report so implementor doesn't look for a missing file
    writeFileSync(
        ".descend/evaluator/report.md",
        "# Initial State\n\nThis is the first iteration. No previous evaluation exists.\nFocus on making initial progress toward the goal.\n",
    );

    gitCommitDescendOnly(0, "setup: projected goal.md into per-agent goal files");
}
