import type { CopilotClient } from "@github/copilot-sdk";
import { approveAll } from "@github/copilot-sdk";
import { readFileSync, mkdirSync } from "fs";
import type { AgentConfig } from "../types.js";
import { DEFAULT_TIMEOUT } from "../types.js";
import { gitCommitDescendOnly } from "../utils/git.js";
import { attachLogger, log } from "../utils/logger.js";

const SETUP_PROMPT = `You are a setup agent. Your job is to read the user's goal file and project it into three focused goal files for the implementor, evaluator, and terminator agents.

## Instructions

1. Read the goal content provided below
2. Create three files by extracting and rewriting the relevant parts:

### .descend/implementor/goal.md
Write what the implementor should BUILD. Extract the core goal/objective.

### .descend/evaluator/goal.md
Write what the evaluator should JUDGE AGAINST. Include:
- The goal (what success looks like)
- The progress metric (how to measure progress)

### .descend/terminator/goal.md
Write what the terminator should CHECK FOR CONVERGENCE. Include:
- The termination condition (when to stop)
- The progress metric (how to measure if we're done)

## Constraints

- Create the directories if needed (.descend/implementor/, .descend/evaluator/, .descend/terminator/)
- Write clear, actionable goal files — each agent only sees its own file
- If the goal doesn't explicitly separate metric/termination, infer reasonable ones from context
- Do NOT modify any files outside .descend/
`;

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
        systemMessage: { mode: "replace", content: SETUP_PROMPT },
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

    gitCommitDescendOnly(0, "setup: projected goal.md into per-agent goal files");
}
