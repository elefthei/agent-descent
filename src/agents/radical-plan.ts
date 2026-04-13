import type { CopilotClient } from "@github/copilot-sdk";
import { approveAll } from "@github/copilot-sdk";
import type { AgentConfig, Implementor, ImplementorResult } from "../types.js";
import { DEFAULT_TIMEOUT } from "../types.js";
import { attachLogger } from "../utils/logger.js";
import { loadPrompt } from "../utils/prompt.js";
import { withSession } from "../utils/session.js";

export interface RadicalPlanInput {
    goalContent: string;
    failureReports: string[];
}

class RadicalPlanImplementor implements Implementor<RadicalPlanInput> {
    name = "implementor:radical-plan";

    async run(client: CopilotClient, config: AgentConfig, ctx: RadicalPlanInput): Promise<ImplementorResult> {
        return withSession(client, {
            workingDirectory: process.cwd(),
            model: config.model,
            reasoningEffort: config.reasoningEffort ?? "high",
            systemMessage: { mode: "replace", content: loadPrompt("evaluator-radical", { CWD: process.cwd() }) },
            onPermissionRequest: approveAll,
            infiniteSessions: { enabled: false },
            streaming: true,
        }, async (session) => {
            attachLogger(session, this.name);

            const failureSection = ctx.failureReports
                .map((report, i) => `### Rejection ${i + 1}\n\n${report}`)
                .join("\n\n---\n\n");

            await session.sendAndWait({
                prompt: [
                    "## Original Goal", ctx.goalContent, "",
                    "## Cumulative Failure Reports (most recent last)", failureSection, "",
                    "The implementor has been rejected multiple times in a row.",
                    "Analyze the pattern of failures and write a RADICAL PLAN to .descend/evaluator/report.md.",
                    "Think from first principles — start from the goal, not from the failed approaches.",
                ].join("\n"),
            }, config.timeout ?? DEFAULT_TIMEOUT);

            return { kinds: new Set(["Plan"]), feedback: "Radical plan written", iterations: 1 } as ImplementorResult;
        });
    }
}

export const radicalPlanImplementor = new RadicalPlanImplementor();
