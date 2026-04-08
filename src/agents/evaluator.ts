import type { CopilotClient } from "@github/copilot-sdk";
import { approveAll } from "@github/copilot-sdk";
import {
    createAxisScoreTool,
    createSymbolicReportTool,
    type AxisResult,
    type SymbolicResult,
    type EvaluatorDecision,
    type AxisScores,
    type AxisIssues,
} from "../tools/decisions.js";
import type { Agent, Orchestrator, AgentConfig } from "../types.js";
import { DEFAULT_TIMEOUT } from "../types.js";
import { EVALUATOR_FEATURES_PROMPT } from "../prompts/evaluator-features.js";
import { EVALUATOR_RELIABILITY_PROMPT } from "../prompts/evaluator-reliability.js";
import { EVALUATOR_MODULARITY_PROMPT } from "../prompts/evaluator-modularity.js";
import { EVALUATOR_SYMBOLIC_PROMPT } from "../prompts/evaluator-symbolic.js";
import { EVALUATOR_SYNTHESIZER_PROMPT } from "../prompts/evaluator-synthesizer.js";
import { EVALUATOR_RADICAL_PROMPT } from "../prompts/evaluator-radical.js";
import { attachLogger, log } from "../utils/logger.js";
import { getGitDiff } from "../utils/git.js";
import { readFileOrDefault, readDirContents } from "../utils/files.js";

// Re-export for backward compatibility
export type { EvaluatorDecision } from "../tools/decisions.js";
export type EvaluatorContext = AgentConfig;

// ── Shared context built once, passed to all subagents ──────

interface EvalInput {
    baselineSha?: string;
}

interface EvalContext {
    evalGoal: string;
    gitDiff: string;
    implReport: string;
    researchNotes: string;
    planNotes: string;
}

function buildEvalContext(baselineSha?: string): EvalContext {
    return {
        evalGoal: readFileOrDefault(".descend/evaluator/goal.md", "No evaluator goal found."),
        gitDiff: getGitDiff(baselineSha),
        implReport: readFileOrDefault(".descend/implementor/report.md", "No implementor report found."),
        researchNotes: readDirContents(".descend/research"),
        planNotes: readDirContents(".descend/plan"),
    };
}

function buildAxisPrompt(evalCtx: EvalContext): string {
    return [
        "## Evaluator Goal",
        evalCtx.evalGoal,
        "",
        "## Git Diff",
        "```diff",
        evalCtx.gitDiff || "(no changes)",
        "```",
        "",
        "## Implementor Report",
        evalCtx.implReport,
        "",
        "Score this diff on your axis. Call submit_axis_score with your score and issues.",
    ].join("\n");
}

// ── Axis Evaluator Agent ────────────────────────────────────

type AxisName = "features" | "reliability" | "modularity";

const AXIS_PROMPTS: Record<AxisName, string> = {
    features: EVALUATOR_FEATURES_PROMPT,
    reliability: EVALUATOR_RELIABILITY_PROMPT,
    modularity: EVALUATOR_MODULARITY_PROMPT,
};

class AxisEvaluatorAgent implements Agent<EvalContext, AxisResult> {
    name: string;
    private axis: AxisName;

    constructor(axis: AxisName) {
        this.axis = axis;
        this.name = `evaluator:${axis}`;
    }

    async run(client: CopilotClient, config: AgentConfig, ctx: EvalContext): Promise<AxisResult> {
        const { tool, getResult } = createAxisScoreTool(this.axis);

        const session = await client.createSession({
            model: config.model,
            reasoningEffort: config.reasoningEffort ?? "high",
            systemMessage: { mode: "replace", content: AXIS_PROMPTS[this.axis]! },
            tools: [tool],
            onPermissionRequest: approveAll,
            infiniteSessions: { enabled: false },
            streaming: true,
        });
        attachLogger(session, this.name);

        await session.sendAndWait({ prompt: buildAxisPrompt(ctx) }, config.timeout ?? DEFAULT_TIMEOUT);
        await session.disconnect();
        await client.deleteSession(session.sessionId);

        const result = getResult();
        if (!result) {
            throw new Error(`${this.name} did not call submit_axis_score`);
        }
        return result;
    }
}

// ── Symbolic Evaluator Agent ────────────────────────────────

class SymbolicEvaluatorAgent implements Agent<EvalContext, SymbolicResult> {
    name = "evaluator:symbolic";

    async run(client: CopilotClient, config: AgentConfig, ctx: EvalContext): Promise<SymbolicResult> {
        const { tool, getResult } = createSymbolicReportTool();

        const session = await client.createSession({
            model: config.model,
            reasoningEffort: config.reasoningEffort ?? "high",
            systemMessage: { mode: "replace", content: EVALUATOR_SYMBOLIC_PROMPT },
            tools: [tool],
            onPermissionRequest: approveAll,
            infiniteSessions: { enabled: false },
            streaming: true,
        });
        attachLogger(session, this.name);

        const prompt = [
            "## Evaluator Goal",
            ctx.evalGoal,
            "",
            "## Git Diff",
            "```diff",
            ctx.gitDiff || "(no changes)",
            "```",
            "",
            "## Implementor Report",
            ctx.implReport,
            "",
            "Discover what symbolic checks are available, run them, and report findings.",
            "Call submit_symbolic_report with your results.",
        ].join("\n");

        await session.sendAndWait({ prompt }, config.timeout ?? DEFAULT_TIMEOUT);
        await session.disconnect();
        await client.deleteSession(session.sessionId);

        const result = getResult();
        if (!result) {
            throw new Error("evaluator:symbolic did not call submit_symbolic_report");
        }
        return result;
    }
}

// ── Synthesizer Agent ───────────────────────────────────────

interface SynthContext {
    evalCtx: EvalContext;
    scores: AxisScores;
    issues: AxisIssues;
    symbolic: SymbolicResult;
    decision: "approve" | "reject";
    remainingWork: string[];
}

class SynthesizerAgent implements Agent<SynthContext, void> {
    name = "evaluator:synthesizer";

    async run(client: CopilotClient, config: AgentConfig, ctx: SynthContext): Promise<void> {
        const session = await client.createSession({
            model: config.model,
            reasoningEffort: config.reasoningEffort ?? "high",
            systemMessage: { mode: "replace", content: EVALUATOR_SYNTHESIZER_PROMPT },
            onPermissionRequest: approveAll,
            infiniteSessions: { enabled: false },
            streaming: true,
        });
        attachLogger(session, this.name);

        const prompt = [
            "## Decision",
            ctx.decision === "approve" ? "APPROVED" : "REJECTED",
            "",
            "## Axis Scores",
            `- Features: ${ctx.scores.features}/100`,
            `- Reliability: ${ctx.scores.reliability}/100`,
            `- Modularity: ${ctx.scores.modularity}/100`,
            "",
            "## Features Issues",
            ctx.issues.features.length === 0 ? "No issues." : ctx.issues.features.map(i => `- ${i}`).join("\n"),
            "",
            "## Reliability Issues",
            ctx.issues.reliability.length === 0 ? "No issues." : ctx.issues.reliability.map(i => `- ${i}`).join("\n"),
            "",
            "## Modularity Issues",
            ctx.issues.modularity.length === 0 ? "No issues." : ctx.issues.modularity.map(i => `- ${i}`).join("\n"),
            "",
            "## Symbolic Checking (advisory — no score)",
            `**Available checks**: ${ctx.symbolic.availableChecks.length === 0 ? "none found" : ctx.symbolic.availableChecks.join(", ")}`,
            ctx.symbolic.findings.length > 0
                ? `**Findings**:\n${ctx.symbolic.findings.map(f => `- ${f}`).join("\n")}`
                : "**Findings**: none",
            ctx.symbolic.suggestions.length > 0
                ? `**Suggestions**:\n${ctx.symbolic.suggestions.map(s => `- ${s}`).join("\n")}`
                : "**Suggestions**: none",
            "",
            "## Evaluator Goal",
            ctx.evalCtx.evalGoal,
            "",
            "Write the final evaluation report to .descend/evaluator/report.md.",
            "Include a Symbolic Checking section with the findings and suggestions above.",
        ].join("\n");

        await session.sendAndWait({ prompt }, config.timeout ?? DEFAULT_TIMEOUT);
        await session.disconnect();
        await client.deleteSession(session.sessionId);
    }
}

// ── Evaluator Orchestrator ──────────────────────────────────

const APPROVE_THRESHOLD = 50;

const featuresAgent = new AxisEvaluatorAgent("features");
const reliabilityAgent = new AxisEvaluatorAgent("reliability");
const modularityAgent = new AxisEvaluatorAgent("modularity");
const symbolicAgent = new SymbolicEvaluatorAgent();
const synthesizerAgent = new SynthesizerAgent();

class EvaluatorOrchestrator implements Orchestrator<EvalInput, EvaluatorDecision> {
    name = "evaluator";
    agents = [featuresAgent, reliabilityAgent, modularityAgent, symbolicAgent, synthesizerAgent];

    async run(client: CopilotClient, config: AgentConfig, input: EvalInput): Promise<EvaluatorDecision> {
        const evalCtx = buildEvalContext(input.baselineSha);

        // Run three axis evaluators + symbolic checker sequentially
        log.system("   → evaluator:features");
        const featuresResult = await featuresAgent.run(client, config, evalCtx);
        log.system(`   ← features: ${featuresResult.score}/100`);

        log.system("   → evaluator:reliability");
        const reliabilityResult = await reliabilityAgent.run(client, config, evalCtx);
        log.system(`   ← reliability: ${reliabilityResult.score}/100`);

        log.system("   → evaluator:modularity");
        const modularityResult = await modularityAgent.run(client, config, evalCtx);
        log.system(`   ← modularity: ${modularityResult.score}/100`);

        log.system("   → evaluator:symbolic");
        const symbolicResult = await symbolicAgent.run(client, config, evalCtx);
        log.system(`   ← symbolic: ${symbolicResult.availableChecks.length} checks, ${symbolicResult.findings.length} findings`);

        // Derive decision (symbolic does NOT affect approval — advisory only)
        const scores: AxisScores = {
            features: featuresResult.score,
            reliability: reliabilityResult.score,
            modularity: modularityResult.score,
        };
        const issues: AxisIssues = {
            features: featuresResult.issues,
            reliability: reliabilityResult.issues,
            modularity: modularityResult.issues,
        };
        const maxScore = Math.max(scores.features, scores.reliability, scores.modularity);
        const decision = maxScore >= APPROVE_THRESHOLD ? "approve" as const : "reject" as const;
        const allIssues = [...issues.features, ...issues.reliability, ...issues.modularity];

        // Run synthesizer to write report.md (includes symbolic findings)
        log.system("   → evaluator:synthesizer");
        await synthesizerAgent.run(client, config, {
            evalCtx,
            scores,
            issues,
            symbolic: symbolicResult,
            decision,
            remainingWork: allIssues,
        });
        log.system("   ← report.md written");

        return {
            decision,
            summary: `features=${scores.features}, reliability=${scores.reliability}, modularity=${scores.modularity} (max=${maxScore})`,
            scores,
            issues,
            remainingWork: allIssues,
            testsStatus: "none",
        };
    }
}

const evaluatorOrchestrator = new EvaluatorOrchestrator();

// ── Public API (unchanged signature) ────────────────────────

export async function runEvaluator(
    client: CopilotClient,
    ctx: AgentConfig,
    baselineSha?: string,
): Promise<EvaluatorDecision> {
    return evaluatorOrchestrator.run(client, ctx, { baselineSha });
}

export async function runRadicalPlan(
    client: CopilotClient,
    ctx: AgentConfig,
    goalContent: string,
    failureReports: string[],
): Promise<void> {
    const session = await client.createSession({
        model: ctx.model,
        reasoningEffort: ctx.reasoningEffort ?? "high",
        systemMessage: { mode: "replace", content: EVALUATOR_RADICAL_PROMPT },
        onPermissionRequest: approveAll,
        infiniteSessions: { enabled: false },
        streaming: true,
    });
    attachLogger(session, "evaluator");

    const failureSection = failureReports
        .map((report, i) => `### Rejection ${i + 1}\n\n${report}`)
        .join("\n\n---\n\n");

    await session.sendAndWait({
        prompt: [
            "## Original Goal",
            goalContent,
            "",
            "## Cumulative Failure Reports (most recent last)",
            failureSection,
            "",
            "The implementor has been rejected multiple times in a row.",
            "Analyze the pattern of failures and write a RADICAL PLAN to .descend/evaluator/report.md.",
            "Think from first principles — start from the goal, not from the failed approaches.",
        ].join("\n"),
    }, ctx.timeout ?? DEFAULT_TIMEOUT);

    await session.disconnect();
    await client.deleteSession(session.sessionId);
}
