import type { CopilotClient } from "@github/copilot-sdk";
import { approveAll } from "@github/copilot-sdk";
import type { AgentConfig, Implementor, ImplementorResult } from "../types.js";
import { DEFAULT_TIMEOUT } from "../types.js";
import { attachLogger, log } from "../utils/logger.js";
import { loadPrompt } from "../utils/prompt.js";
import { withSession } from "../utils/session.js";
import { readFileOrDefault, readDirContents } from "../utils/files.js";
import { existsSync, readFileSync } from "fs";

// 4 hours for deep recovery analysis
const RECOVERY_TIMEOUT = 4 * 60 * 60 * 1000;

class RecoveryResearcher implements Implementor<string | undefined> {
    name = "implementor:recovery";

    async run(client: CopilotClient, config: AgentConfig, feedbackPath?: string): Promise<ImplementorResult> {
        log.system("🔬 Recovery researcher starting deep analysis...");

        const goalFile = readFileOrDefault(".descend/implementor/goal.md", "No goal file found.");
        const evalGoal = readFileOrDefault(".descend/evaluator/goal.md", "No evaluator goal found.");
        const stateJson = existsSync(".descend/state.json")
            ? readFileSync(".descend/state.json", "utf-8")
            : "No state.json found.";

        // Collect archived reports
        const archivedReports = collectArchivedReports();

        return withSession(client, {
            workingDirectory: process.cwd(),
            model: config.model,
            reasoningEffort: config.reasoningEffort ?? "high",
            systemMessage: { mode: "replace", content: loadPrompt("recovery-research", { CWD: process.cwd() }) },
            onPermissionRequest: approveAll,
            infiniteSessions: { enabled: false },
            streaming: true,
        }, async (session) => {
            attachLogger(session, this.name);
            await session.sendAndWait({
                prompt: [
                    "## Implementor Goal", goalFile, "",
                    "## Evaluator Goal", evalGoal, "",
                    "## State (iteration history, scores, decisions)",
                    "```json", stateJson, "```", "",
                    "## Archived Reports",
                    archivedReports, "",
                    ...(feedbackPath ? ["## User Feedback", readFileOrDefault(feedbackPath, ""), ""] : []),
                    "Analyze deeply. Take your time. Write the recovery plan to .descend/evaluator/report.md.",
                ].join("\n"),
            }, config.timeout ?? RECOVERY_TIMEOUT);

            log.system("🔬 Recovery analysis complete.");
            return { kinds: new Set(["Research"]), feedback: "Recovery analysis complete", iterations: 1 } as ImplementorResult;
        });
    }
}

function collectArchivedReports(): string {
    const sections: string[] = [];
    for (let i = 1; i <= 20; i++) {
        const evalPath = `.descend/history/iteration-${i}/evaluator/report.md`;
        const implPath = `.descend/history/iteration-${i}/implementor/report.md`;
        const evalReport = existsSync(evalPath) ? readFileSync(evalPath, "utf-8") : null;
        const implReport = existsSync(implPath) ? readFileSync(implPath, "utf-8") : null;
        if (!evalReport && !implReport) continue;

        sections.push(`### Iteration ${i}`);
        if (evalReport) sections.push(`**Evaluator:**\n${evalReport.slice(0, 2000)}`);
        if (implReport) sections.push(`**Implementor:**\n${implReport.slice(0, 2000)}`);
        sections.push("");
    }
    return sections.length > 0 ? sections.join("\n") : "No archived reports found.";
}

export const recoveryResearcher = new RecoveryResearcher();
