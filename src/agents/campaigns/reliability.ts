import type { CopilotClient } from "@github/copilot-sdk";
import { approveAll } from "@github/copilot-sdk";
import type { AgentConfig, Implementor, ImplementorResult } from "../../types.js";
import { DEFAULT_TIMEOUT } from "../../types.js";
import { createImplementorResultTool } from "../../tools/decisions.js";
import { attachLogger, log } from "../../utils/logger.js";
import { loadPrompt } from "../../utils/prompt.js";
import { readFileOrDefault } from "../../utils/files.js";
import { withSession } from "../../utils/session.js";

const CAMPAIGN_TIMEOUT = 4 * 60 * 60 * 1000; // 4 hours for long campaigns

class ReliabilityCampaign implements Implementor<void> {
    name = "implementor:campaign:reliability";

    async run(client: CopilotClient, config: AgentConfig): Promise<ImplementorResult> {
        log.system("🛡️ Reliability Campaign starting...");

        const goalFile = readFileOrDefault(".descend/implementor/goal.md", "No goal file found.");
        const evalReport = readFileOrDefault(".descend/evaluator/report.md", "No evaluator report.");
        const { tool, getResult } = createImplementorResultTool();

        return withSession(client, {
            workingDirectory: process.cwd(),
            model: config.model,
            reasoningEffort: config.reasoningEffort ?? "high",
            systemMessage: { mode: "replace", content: loadPrompt("campaign-reliability", { CWD: process.cwd() }) },
            tools: [tool],
            onPermissionRequest: approveAll,
            infiniteSessions: { enabled: false },
            streaming: true,
        }, async (session) => {
            attachLogger(session, this.name);
            await session.sendAndWait({
                prompt: [
                    "## Goal", goalFile, "",
                    "## Evaluator Report (reliability has been declining)", evalReport, "",
                    "Run the reliability campaign. Audit coverage, write tests/proofs, verify.",
                ].join("\n"),
            }, config.timeout ?? CAMPAIGN_TIMEOUT);

            log.system("🛡️ Reliability Campaign complete.");
            const result = getResult();
            if (result) return { ...result, iterations: 1 };
            return { kinds: new Set(["Reliability"]), feedback: "Reliability campaign completed", iterations: 1 } as ImplementorResult;
        });
    }
}

export const reliabilityCampaign = new ReliabilityCampaign();
