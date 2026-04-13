import type { CopilotClient } from "@github/copilot-sdk";
import { approveAll } from "@github/copilot-sdk";
import type { AgentConfig, Implementor, ImplementorResult } from "../../types.js";
import { DEFAULT_TIMEOUT } from "../../types.js";
import { createImplementorResultTool } from "../../tools/decisions.js";
import { attachLogger, log } from "../../utils/logger.js";
import { loadPrompt } from "../../utils/prompt.js";
import { readFileOrDefault } from "../../utils/files.js";

const CAMPAIGN_TIMEOUT = 4 * 60 * 60 * 1000;

class ModularityCampaign implements Implementor<void> {
    name = "implementor:campaign:modularity";

    async run(client: CopilotClient, config: AgentConfig): Promise<ImplementorResult> {
        log.system("🏗️ Modularity Campaign starting...");

        const goalFile = readFileOrDefault(".descend/implementor/goal.md", "No goal file found.");
        const evalReport = readFileOrDefault(".descend/evaluator/report.md", "No evaluator report.");
        const { tool, getResult } = createImplementorResultTool();

        const session = await client.createSession({
            workingDirectory: process.cwd(),
            model: config.model,
            reasoningEffort: config.reasoningEffort ?? "high",
            systemMessage: { mode: "replace", content: loadPrompt("campaign-modularity", { CWD: process.cwd() }) },
            tools: [tool],
            onPermissionRequest: approveAll,
            infiniteSessions: { enabled: false },
            streaming: true,
        });
        attachLogger(session, this.name);

        await session.sendAndWait({
            prompt: [
                "## Goal",
                goalFile,
                "",
                "## Evaluator Report (modularity has been declining)",
                evalReport,
                "",
                "Run the refactoring campaign. Audit structure, refactor, verify.",
            ].join("\n"),
        }, config.timeout ?? CAMPAIGN_TIMEOUT);

        await session.disconnect();
        await client.deleteSession(session.sessionId);

        log.system("🏗️ Modularity Campaign complete.");

        const result = getResult();
        if (result) {
            return { ...result, iterations: 1 };
        }
        return { kinds: new Set(["Refactor"]), feedback: "Modularity campaign completed", iterations: 1 };
    }
}

export const modularityCampaign = new ModularityCampaign();
