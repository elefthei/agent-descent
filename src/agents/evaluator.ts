import type { CopilotClient } from "@github/copilot-sdk";
import { approveAll } from "@github/copilot-sdk";
import {
    createAxisScoreTool,
    createSymbolicReportTool,
} from "../tools/decisions.js";
import type { Agent, Orchestrator, AgentConfig, EvaluatorResult, EvalOrchestratorResult, GatekeeperResult } from "../types.js";
import { DEFAULT_TIMEOUT } from "../types.js";
import { Gate, type Rule } from "../rules.js";
import { attachLogger, log } from "../utils/logger.js";
import { getGitDiff } from "../utils/git.js";
import { readFileOrDefault, readDirContents } from "../utils/files.js";
import { loadPrompt } from "../utils/prompt.js";

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
    features: "evaluator-features",
    reliability: "evaluator-reliability",
    modularity: "evaluator-modularity",
};

class AxisEvaluatorAgent implements Agent<EvalContext, EvaluatorResult> {
    name: string;
    private axis: AxisName;

    constructor(axis: AxisName) {
        this.axis = axis;
        this.name = `evaluator:${axis}`;
    }

    async run(client: CopilotClient, config: AgentConfig, ctx: EvalContext): Promise<EvaluatorResult> {
        const { tool, getResult } = createAxisScoreTool(this.axis);

        const session = await client.createSession({
        workingDirectory: process.cwd(),
            model: config.model,
            reasoningEffort: config.reasoningEffort ?? "high",
            systemMessage: { mode: "replace", content: loadPrompt(AXIS_PROMPTS[this.axis]!, { CWD: process.cwd() }) },
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
        return { score: result.score, feedback: result.issues.join("; ") };
    }
}

// ── Symbolic Evaluator Agent ────────────────────────────────

class SymbolicEvaluatorAgent implements Agent<EvalContext, EvaluatorResult> {
    name = "evaluator:symbolic";

    async run(client: CopilotClient, config: AgentConfig, ctx: EvalContext): Promise<EvaluatorResult> {
        const { tool, getResult } = createSymbolicReportTool();

        const session = await client.createSession({
        workingDirectory: process.cwd(),
            model: config.model,
            reasoningEffort: config.reasoningEffort ?? "high",
            systemMessage: { mode: "replace", content: loadPrompt("evaluator-symbolic", { CWD: process.cwd() }) },
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
        const feedback = [
            ...result.findings,
            ...result.suggestions.map((s: string) => `Suggestion: ${s}`),
        ].join("; ");
        return { score: 0, feedback: feedback || "No symbolic findings" };
    }
}

// ── Synthesizer Agent ───────────────────────────────────────

interface SynthContext {
    evalCtx: EvalContext;
    results: Map<string, EvaluatorResult>;
    decision: "approve" | "reject";
}

class SynthesizerAgent implements Agent<SynthContext, void> {
    name = "evaluator:synthesizer";

    async run(client: CopilotClient, config: AgentConfig, ctx: SynthContext): Promise<void> {
        const session = await client.createSession({
        workingDirectory: process.cwd(),
            model: config.model,
            reasoningEffort: config.reasoningEffort ?? "high",
            systemMessage: { mode: "replace", content: loadPrompt("evaluator-synthesizer", { CWD: process.cwd() }) },
            onPermissionRequest: approveAll,
            infiniteSessions: { enabled: false },
            streaming: true,
        });
        attachLogger(session, this.name);

        const lines: string[] = [
            "## Decision",
            ctx.decision === "approve" ? "APPROVED" : "REJECTED",
            "",
        ];

        for (const [name, result] of ctx.results) {
            lines.push(`## ${name} (${result.score}/100)`);
            lines.push(result.feedback || "No issues.");
            lines.push("");
        }

        lines.push("## Evaluator Goal");
        lines.push(ctx.evalCtx.evalGoal);
        lines.push("");
        lines.push("Write the final evaluation report to .descend/evaluator/report.md.");

        const prompt = lines.join("\n");

        await session.sendAndWait({ prompt }, config.timeout ?? DEFAULT_TIMEOUT);
        await session.disconnect();
        await client.deleteSession(session.sessionId);
    }
}

// ── Gatekeeper Rules (propositional logic) ──────────────────

type EvalResults = Map<string, EvaluatorResult>;

const scoreAbove = (name: string, threshold: number): Rule<EvalResults> =>
    (ctx) => {
        const r = ctx.get(name);
        if (!r) return "CONTINUE";
        return Gate.fromBool(r.score >= threshold);
    };

const anyScoreZero: Rule<EvalResults> = (ctx) => {
    for (const [name, r] of ctx) {
        if (name !== "symbolic" && r.score === 0) return "SUCCESS"; // zero found
    }
    return "FAILURE"; // no zeros
};

const buildFailure: Rule<EvalResults> = (ctx) => {
    const sym = ctx.get("symbolic");
    if (!sym) return "CONTINUE";
    return Gate.fromBool(sym.feedback.includes("FAIL:"));
};

// Approve if strong on any axis, AND no zeros, AND no build failures
const approvalRule: Rule<EvalResults> = Gate.and(
    Gate.or(
        scoreAbove("features", 50),
        scoreAbove("reliability", 50),
        scoreAbove("modularity", 50),
    ),
    Gate.not(anyScoreZero),
    Gate.not(buildFailure),
);

// ── Evaluator Orchestrator ──────────────────────────────────

const featuresAgent = new AxisEvaluatorAgent("features");
const reliabilityAgent = new AxisEvaluatorAgent("reliability");
const modularityAgent = new AxisEvaluatorAgent("modularity");
const symbolicAgent = new SymbolicEvaluatorAgent();
const synthesizerAgent = new SynthesizerAgent();

class EvaluatorOrchestrator implements Orchestrator<EvalInput, EvalOrchestratorResult> {
    name = "evaluator";
    agents = [featuresAgent, reliabilityAgent, modularityAgent, symbolicAgent, synthesizerAgent];

    async run(client: CopilotClient, config: AgentConfig, input: EvalInput): Promise<EvalOrchestratorResult> {
        const evalCtx = buildEvalContext(input.baselineSha);

        // Run all evaluators sequentially, collect results
        const results: EvalResults = new Map();

        for (const [name, agent] of [
            ["features", featuresAgent],
            ["reliability", reliabilityAgent],
            ["modularity", modularityAgent],
            ["symbolic", symbolicAgent],
        ] as const) {
            log.system(`   → evaluator:${name}`);
            const result = await (agent as Agent<EvalContext, EvaluatorResult>).run(client, config, evalCtx);
            results.set(name, result);
            log.system(`   ← ${name}: ${result.score}/100`);
        }

        // Apply gatekeeper rules
        const gateResult = approvalRule(results);
        const decision = gateResult === "SUCCESS" ? "approve" as const : "reject" as const;

        // Compute aggregate score + feedback
        const scoringAxes = [...results.entries()].filter(([name]) => name !== "symbolic");
        const maxScore = Math.max(...scoringAxes.map(([, r]) => r.score));
        const allFeedback = [...results.values()].map(r => r.feedback).filter(Boolean);

        // Run synthesizer to write report.md
        log.system("   → evaluator:synthesizer");
        await synthesizerAgent.run(client, config, { evalCtx, results, decision });
        log.system("   ← report.md written");

        return {
            score: maxScore,
            feedback: allFeedback.join("; "),
            axes: results,
            decision,
        };
    }
}

const evaluatorOrchestrator = new EvaluatorOrchestrator();

// ── Terminator Rules (propositional logic) ──────────────────

import type { IterationRecord } from "../utils/state.js";

interface TerminatorContext {
    results: EvalResults;
    history: IterationRecord[];
    iteration: number;
}

const allScoresAbove = (threshold: number): Rule<TerminatorContext> =>
    (ctx) => {
        for (const [name, r] of ctx.results) {
            if (name !== "symbolic" && r.score < threshold) return "FAILURE";
        }
        return "SUCCESS";
    };

const scoresDecreasing: Rule<TerminatorContext> = (ctx) => {
    if (ctx.history.length < 2) return "FAILURE";
    const recent = ctx.history.slice(-2);
    const prev = recent[0]!.scores;
    const curr = recent[1]!.scores;
    if (!prev || !curr) return "CONTINUE";
    const declining = curr.features < prev.features && curr.reliability < prev.reliability && curr.modularity < prev.modularity;
    return Gate.fromBool(declining);
};

const scoresPlateau: Rule<TerminatorContext> = (ctx) => {
    if (ctx.history.length < 3) return "FAILURE";
    const recent = ctx.history.slice(-3);
    const scores = recent.map(r => r.scores).filter(Boolean);
    if (scores.length < 3) return "CONTINUE";
    const maxes = scores.map(s => Math.max(s!.features, s!.reliability, s!.modularity));
    const spread = Math.max(...maxes) - Math.min(...maxes);
    return Gate.fromBool(spread < 5);
};

const earlyIteration: Rule<TerminatorContext> = (ctx) =>
    Gate.fromBool(ctx.iteration <= 2);

/**
 * Terminator convergence rules:
 * SUCCESS = STOP (goal achieved or diverged/plateaued)
 * FAILURE = CONTINUE (more work needed)
 * CONTINUE = defer to agentic terminator
 */
export const terminatorRule: Rule<TerminatorContext> = Gate.or(
    // Rule 1: All scores ≥ 90 → STOP (complete)
    allScoresAbove(90),
    // Rule 3: Scores decreasing → STOP (divergence)
    scoresDecreasing,
    // Rule 4: Plateau → STOP
    scoresPlateau,
);

/** Evaluate terminator rules and return a GatekeeperResult. */
export function evaluateTerminator(
    results: EvalResults,
    history: IterationRecord[],
    iteration: number,
): GatekeeperResult {
    const ctx: TerminatorContext = { results, history, iteration };
    const result = terminatorRule(ctx);

    if (result === "SUCCESS") {
        if (allScoresAbove(90)(ctx) === "SUCCESS") return { result: "SUCCESS", feedback: "All scores ≥ 90 — goal achieved" };
        if (scoresDecreasing(ctx) === "SUCCESS") return { result: "SUCCESS", feedback: "Scores decreasing — divergence detected" };
        if (scoresPlateau(ctx) === "SUCCESS") return { result: "SUCCESS", feedback: "Score plateau — diminishing returns" };
    }

    if (earlyIteration(ctx) === "SUCCESS") {
        return { result: "CONTINUE", feedback: `Iteration ${iteration} ≤ 2 — too early to stop` };
    }

    return { result: "CONTINUE", feedback: "No termination condition met" };
}

// ── Public API ───────────────────────────────────────────────

export async function runEvaluator(
    client: CopilotClient,
    ctx: AgentConfig,
    baselineSha?: string,
): Promise<EvalOrchestratorResult> {
    return evaluatorOrchestrator.run(client, ctx, { baselineSha });
}

export async function runRadicalPlan(
    client: CopilotClient,
    ctx: AgentConfig,
    goalContent: string,
    failureReports: string[],
): Promise<void> {
    const session = await client.createSession({
        workingDirectory: process.cwd(),
        model: ctx.model,
        reasoningEffort: ctx.reasoningEffort ?? "high",
        systemMessage: { mode: "replace", content: loadPrompt("evaluator-radical", { CWD: process.cwd() }) },
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
