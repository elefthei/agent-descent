import type { CopilotClient } from "@github/copilot-sdk";
import { approveAll } from "@github/copilot-sdk";
import { attachLogger } from "../utils/logger.js";
import { readFileOrDefault, readDirContents } from "../utils/files.js";
import { DEFAULT_TIMEOUT } from "../types.js";
import { loadPrompt } from "../utils/prompt.js";
import { createImplementorResultTool } from "../tools/decisions.js";
import { withSession } from "../utils/session.js";
import type { AgentConfig, Implementor, ImplementorResult } from "../types.js";

// ── Research Implementor ────────────────────────────────────

class ResearchImplementor implements Implementor<void> {
    name = "implementor:research";

    async run(client: CopilotClient, config: AgentConfig): Promise<ImplementorResult> {
        const goalFile = readFileOrDefault(".descend/implementor/goal.md", "No goal file found.");
        const evaluatorReport = readFileOrDefault(".descend/evaluator/report.md", "No previous evaluator report.");

        return withSession(client, {
            workingDirectory: process.cwd(),
            model: config.model,
            reasoningEffort: config.reasoningEffort ?? "high",
            systemMessage: { mode: "replace", content: loadPrompt("implementor-research", { CWD: process.cwd() }) },
            onPermissionRequest: approveAll,
            infiniteSessions: { enabled: false },
            streaming: true,
        }, async (session) => {
            attachLogger(session, this.name);
            await session.sendAndWait({
                prompt: [
                    "## Goal", goalFile, "",
                    "## Previous Evaluator Report", evaluatorReport, "",
                    "Research what is needed to address the goal and evaluator feedback.",
                    "Save structured notes to .descend/research/ as markdown files.",
                ].join("\n"),
            }, config.timeout ?? DEFAULT_TIMEOUT);
            return { kinds: new Set(["Research"]), feedback: "Research phase completed", iterations: 1 } as ImplementorResult;
        });
    }
}

// ── Plan Implementor ────────────────────────────────────────

class PlanImplementor implements Implementor<void> {
    name = "implementor:plan";

    async run(client: CopilotClient, config: AgentConfig): Promise<ImplementorResult> {
        const goalFile = readFileOrDefault(".descend/implementor/goal.md", "No goal file found.");
        const evaluatorReport = readFileOrDefault(".descend/evaluator/report.md", "No previous evaluator report.");
        const researchNotes = readDirContents(".descend/research");

        return withSession(client, {
            workingDirectory: process.cwd(),
            model: config.model,
            reasoningEffort: config.reasoningEffort ?? "high",
            systemMessage: { mode: "replace", content: loadPrompt("implementor-plan", { CWD: process.cwd() }) },
            onPermissionRequest: approveAll,
            infiniteSessions: { enabled: false },
            streaming: true,
        }, async (session) => {
            attachLogger(session, this.name);
            await session.sendAndWait({
                prompt: [
                    "## Goal", goalFile, "",
                    "## Previous Evaluator Report", evaluatorReport, "",
                    "## Research Notes", researchNotes, "",
                    "Create a detailed attack plan in .descend/plan/ as a markdown file.",
                ].join("\n"),
            }, config.timeout ?? DEFAULT_TIMEOUT);
            return { kinds: new Set(["Plan"]), feedback: "Plan phase completed", iterations: 1 } as ImplementorResult;
        });
    }
}

// ── Exec Implementor ────────────────────────────────────────

class ExecImplementor implements Implementor<void> {
    name = "implementor:exec";

    async run(client: CopilotClient, config: AgentConfig): Promise<ImplementorResult> {
        const goalFile = readFileOrDefault(".descend/implementor/goal.md", "No goal file found.");
        const planNotes = readDirContents(".descend/plan");
        const { tool, getResult } = createImplementorResultTool();

        return withSession(client, {
            workingDirectory: process.cwd(),
            model: config.model,
            reasoningEffort: config.reasoningEffort ?? "high",
            systemMessage: { mode: "replace", content: loadPrompt("implementor-exec", { CWD: process.cwd() }) },
            tools: [tool],
            onPermissionRequest: approveAll,
            infiniteSessions: { enabled: false },
            streaming: true,
        }, async (session) => {
            attachLogger(session, this.name);
            await session.sendAndWait({
                prompt: [
                    "## Goal", goalFile, "",
                    "## Plan", planNotes, "",
                    "Execute the plan. Make code changes.",
                    "Write an execution log to .descend/implementor/report.md when done.",
                    "Then call submit_implementor_result with what you accomplished.",
                ].join("\n"),
            }, config.timeout ?? DEFAULT_TIMEOUT);

            const result = getResult();
            if (result) return { ...result, iterations: 1 };
            return { kinds: new Set(["Feature"]), feedback: "Execution completed (no explicit result submitted)", iterations: 1 } as ImplementorResult;
        });
    }
}

// ── Exports ─────────────────────────────────────────────────

export const researchImplementor = new ResearchImplementor();
export const planImplementor = new PlanImplementor();
export const execImplementor = new ExecImplementor();
