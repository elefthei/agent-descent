import type { CopilotClient } from "@github/copilot-sdk";
import { approveAll } from "@github/copilot-sdk";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import type { AgentConfig, Implementor, ImplementorResult } from "../types.js";
import { DEFAULT_TIMEOUT } from "../types.js";
import { gitCommitDescendOnly } from "../utils/git.js";
import { attachLogger, log } from "../utils/logger.js";
import { loadPrompt } from "../utils/prompt.js";
import { withSession } from "../utils/session.js";

interface SetupInput {
    goalPath: string;
}

class SetupImplementor implements Implementor<SetupInput> {
    name = "implementor:setup";

    async run(client: CopilotClient, config: AgentConfig, ctx: SetupInput): Promise<ImplementorResult> {
        log.setup("🎯 Reading goal.md and projecting per-agent goals...");

        if (existsSync(".descend")) {
            log.setup("   Clearing previous .descend/ state...");
            rmSync(".descend", { recursive: true, force: true });
        }

        mkdirSync(".descend/implementor", { recursive: true });
        mkdirSync(".descend/evaluator", { recursive: true });
        mkdirSync(".descend/terminator", { recursive: true });

        const goalContent = readFileSync(ctx.goalPath, "utf-8");

        await withSession(client, {
            workingDirectory: process.cwd(),
            model: config.model,
            reasoningEffort: config.reasoningEffort ?? "high",
            systemMessage: { mode: "replace", content: loadPrompt("setup", { CWD: process.cwd() }) },
            onPermissionRequest: approveAll,
            infiniteSessions: { enabled: false },
            streaming: true,
        }, async (session) => {
            attachLogger(session, this.name);
            await session.sendAndWait({
                prompt: [
                    "Use absolute paths for all file operations (view, glob, grep, create, edit).",
                    "", "## Goal File Contents", "", goalContent, "",
                    "Project this into the three goal files now.",
                ].join("\n"),
            }, config.timeout ?? DEFAULT_TIMEOUT);
        });

        log.setup("✅ Goal files projected:");
        log.setup("   .descend/implementor/goal.md");
        log.setup("   .descend/evaluator/goal.md");
        log.setup("   .descend/terminator/goal.md");

        writeFileSync(
            ".descend/evaluator/report.md",
            "# Initial State\n\nThis is the first iteration. No previous evaluation exists.\nFocus on making initial progress toward the goal.\n",
        );

        gitCommitDescendOnly(0, "setup: projected goal.md into per-agent goal files");
        return { kinds: new Set(["Plan"]), feedback: "Setup complete — goal files projected", iterations: 1 };
    }
}

export const setupImplementor = new SetupImplementor();
export type { SetupInput };
