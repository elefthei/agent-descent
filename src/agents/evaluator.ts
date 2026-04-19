import type { CopilotClient } from "@github/copilot-sdk";
import { approveAll } from "@github/copilot-sdk";
import {
    createAxisScoreTool,
    createSymbolicReportTool,
} from "../tools/decisions.js";
import type { Agent, Evaluator, Validator, AgentConfig, EvaluatorResult, EvalOrchestratorResult, GatekeeperResult, EvalResults, GoalWeights } from "../types.js";
import { DEFAULT_TIMEOUT, weightedScore, weightedGaps } from "../types.js";
import { Gate, type Rule } from "../rules.js";
import { attachLogger, log } from "../utils/logger.js";
import { getGitDiff } from "../utils/git.js";
import { readFileOrDefault, readDirContents } from "../utils/files.js";
import { loadPrompt } from "../utils/prompt.js";
import { withSession } from "../utils/session.js";
import { loadGoalWeights } from "../utils/state.js";

// ── Shared context built once, passed to all subagents ──────

interface EvalInput {
    baselineSha?: string;
    feedbackPath?: string;
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

// ── Axis Evaluator ──────────────────────────────────────────

type AxisName = "features" | "reliability" | "modularity";

const AXIS_PROMPTS: Record<AxisName, string> = {
    features: "evaluator-features",
    reliability: "evaluator-reliability",
    modularity: "evaluator-modularity",
};

class AxisEvaluator implements Evaluator<EvalContext> {
    name: string;
    private axis: AxisName;

    constructor(axis: AxisName) {
        this.axis = axis;
        this.name = `evaluator:${axis}`;
    }

    async run(client: CopilotClient, config: AgentConfig, ctx: EvalContext): Promise<EvaluatorResult> {
        const { tool, getResult } = createAxisScoreTool(this.axis);

        return withSession(client, {
            workingDirectory: process.cwd(),
            model: config.model,
            reasoningEffort: config.reasoningEffort ?? "high",
            systemMessage: { mode: "replace", content: loadPrompt(AXIS_PROMPTS[this.axis]!, { CWD: process.cwd() }) },
            tools: [tool],
            onPermissionRequest: approveAll,
            infiniteSessions: { enabled: false },
            streaming: true,
        }, async (session) => {
            attachLogger(session, this.name);
            await session.sendAndWait({ prompt: buildAxisPrompt(ctx) }, config.timeout ?? DEFAULT_TIMEOUT);

            const result = getResult();
            if (!result) throw new Error(`${this.name} did not call submit_axis_score`);
            return { score: result.score, feedback: result.issues.join("; ") };
        });
    }
}

// ── Symbolic Evaluator ──────────────────────────────────────

class SymbolicEvaluator implements Evaluator<EvalContext> {
    name = "evaluator:symbolic";

    async run(client: CopilotClient, config: AgentConfig, ctx: EvalContext): Promise<EvaluatorResult> {
        const { tool, getResult } = createSymbolicReportTool();

        return withSession(client, {
            workingDirectory: process.cwd(),
            model: config.model,
            reasoningEffort: config.reasoningEffort ?? "high",
            systemMessage: { mode: "replace", content: loadPrompt("evaluator-symbolic", { CWD: process.cwd() }) },
            tools: [tool],
            onPermissionRequest: approveAll,
            infiniteSessions: { enabled: false },
            streaming: true,
        }, async (session) => {
            attachLogger(session, this.name);

            const prompt = [
                "## Evaluator Goal", ctx.evalGoal, "",
                "## Git Diff", "```diff", ctx.gitDiff || "(no changes)", "```", "",
                "## Implementor Report", ctx.implReport, "",
                "Discover what symbolic checks are available, run them, and report findings.",
                "Call submit_symbolic_report with your results.",
            ].join("\n");

            await session.sendAndWait({ prompt }, config.timeout ?? DEFAULT_TIMEOUT);

            const result = getResult();
            if (!result) throw new Error("evaluator:symbolic did not call submit_symbolic_report");
            const feedback = [
                ...result.findings,
                ...result.suggestions.map((s: string) => `Suggestion: ${s}`),
            ].join("; ");
            return { score: 0, feedback: feedback || "No symbolic findings" };
        });
    }
}

// ── Synthesizer Agent (base Agent — not specialized) ────────

interface SynthContext {
    evalCtx: EvalContext;
    results: Map<string, EvaluatorResult>;
    decision: "approve" | "reject";
    goalWeights: GoalWeights;
    wScore: number;
    wGaps: GoalWeights;
    feedbackPath?: string;
}

class SynthesizerAgent implements Agent<SynthContext, void> {
    name = "evaluator:synthesizer";

    async run(client: CopilotClient, config: AgentConfig, ctx: SynthContext): Promise<void> {
        await withSession(client, {
            workingDirectory: process.cwd(),
            model: config.model,
            reasoningEffort: config.reasoningEffort ?? "high",
            systemMessage: { mode: "replace", content: loadPrompt("evaluator-synthesizer", { CWD: process.cwd() }) },
            onPermissionRequest: approveAll,
            infiniteSessions: { enabled: false },
            streaming: true,
        }, async (session) => {
            attachLogger(session, this.name);

            const lines: string[] = [
                "## Decision", ctx.decision === "approve" ? "APPROVED" : "REJECTED", "",
            ];
            for (const [name, result] of ctx.results) {
                lines.push(`## ${name} (${result.score}/100)`);
                lines.push(result.feedback || "No issues.");
                lines.push("");
            }

            // Weighted scoring analysis
            const w = ctx.goalWeights;
            lines.push("## Goal Weights",
                `- Features: ${(w.features * 100).toFixed(0)}%`,
                `- Reliability: ${(w.reliability * 100).toFixed(0)}%`,
                `- Modularity: ${(w.modularity * 100).toFixed(0)}%`,
                "",
                `## Weighted Score: ${ctx.wScore.toFixed(1)}/100`,
                "### Weighted Gaps (where effort should go)",
                `- Features gap: ${ctx.wGaps.features.toFixed(1)} (weight ${(w.features * 100).toFixed(0)}%)`,
                `- Reliability gap: ${ctx.wGaps.reliability.toFixed(1)} (weight ${(w.reliability * 100).toFixed(0)}%)`,
                `- Modularity gap: ${ctx.wGaps.modularity.toFixed(1)} (weight ${(w.modularity * 100).toFixed(0)}%)`,
                "",
            );

            lines.push("## Evaluator Goal", ctx.evalCtx.evalGoal, "",
                "Write the final evaluation report to .descend/evaluator/report.md.");

            // Include live user feedback if available
            if (ctx.feedbackPath) {
                const feedback = readFileOrDefault(ctx.feedbackPath, "");
                if (feedback) {
                    lines.push("", "## User Feedback (live — incorporate into report)",
                        feedback, "");
                }
            }

            await session.sendAndWait({ prompt: lines.join("\n") }, config.timeout ?? DEFAULT_TIMEOUT);
        });
    }
}

// ── Approval Validator (propositional logic) ────────────────

const scoreAbove = (name: string, threshold: number): Rule<EvalResults> =>
    Gate.lift((ctx) => {
        const r = ctx.get(name);
        if (!r) return "CONTINUE";
        return Gate.fromBool(r.score >= threshold);
    });

const anyScoreZero: Rule<EvalResults> = Gate.lift((ctx) => {
    for (const [name, r] of ctx) {
        if (name !== "symbolic" && r.score === 0) return "SUCCESS"; // zero found
    }
    return "FAILURE"; // no zeros
});

const buildFailure: Rule<EvalResults> = Gate.lift((ctx) => {
    const sym = ctx.get("symbolic");
    if (!sym) return "CONTINUE";
    return Gate.fromBool(sym.feedback.includes("FAIL:"));
});

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

class ApprovalValidator implements Validator<EvalResults> {
    name = "validator:approval";

    rule(): Rule<EvalResults> {
        return approvalRule;
    }

    async run(_client: CopilotClient, _config: AgentConfig, ctx: EvalResults): Promise<GatekeeperResult> {
        const result = await this.rule()(ctx);
        if (result === "SUCCESS") return { result, feedback: "Approval gate passed" };
        if (result === "FAILURE") return { result, feedback: "Approval gate failed" };
        return { result, feedback: "Approval gate deferred" };
    }
}

// ── Evaluator Orchestrator ──────────────────────────────────

const featuresEvaluator = new AxisEvaluator("features");
const reliabilityEvaluator = new AxisEvaluator("reliability");
const modularityEvaluator = new AxisEvaluator("modularity");
const symbolicEvaluator = new SymbolicEvaluator();
const synthesizerAgent = new SynthesizerAgent();
const approvalValidatorInstance = new ApprovalValidator();

class EvaluatorOrchestrator implements Evaluator<EvalInput> {
    name = "evaluator";
    private evaluators: Evaluator<EvalContext>[] = [featuresEvaluator, reliabilityEvaluator, modularityEvaluator, symbolicEvaluator];
    private synthesizer = synthesizerAgent;
    private gate = approvalValidatorInstance;

    async run(client: CopilotClient, config: AgentConfig, input: EvalInput): Promise<EvalOrchestratorResult> {
        const evalCtx = buildEvalContext(input.baselineSha);

        // Run all evaluators concurrently — they are independent
        const evaluatorEntries: [string, Evaluator<EvalContext>][] = [
            ["features", featuresEvaluator],
            ["reliability", reliabilityEvaluator],
            ["modularity", modularityEvaluator],
            ["symbolic", symbolicEvaluator],
        ];

        log.system("   → running evaluators concurrently...");
        const settled = await Promise.allSettled(
            evaluatorEntries.map(async ([name, evaluator]) => {
                log.system(`   → evaluator:${name}`);
                const result = await evaluator.run(client, config, evalCtx);
                log.system(`   ← ${name}: ${result.score}/100`);
                return [name, result] as [string, EvaluatorResult];
            }),
        );

        const results: EvalResults = new Map();
        for (const entry of settled) {
            if (entry.status === "fulfilled") {
                results.set(entry.value[0], entry.value[1]);
            } else {
                log.system(`   ⚠️ evaluator failed: ${entry.reason}`);
            }
        }

        // Apply approval validator
        const gateResult = await this.gate.rule()(results);
        const decision = gateResult === "SUCCESS" ? "approve" as const : "reject" as const;

        // Compute weighted aggregate score using goal weights
        const goalWeights = loadGoalWeights();
        const axisScores = {
            features: results.get("features")?.score ?? 0,
            reliability: results.get("reliability")?.score ?? 0,
            modularity: results.get("modularity")?.score ?? 0,
        };
        const wScore = weightedScore(goalWeights, axisScores);
        const wGaps = weightedGaps(goalWeights, axisScores);
        const allFeedback = [...results.values()].map(r => r.feedback).filter(Boolean);

        // Run synthesizer to write report.md
        log.system("   → evaluator:synthesizer");
        log.system(`   ⚖️ Weighted score: ${wScore.toFixed(1)} (weights: f=${goalWeights.features.toFixed(2)}, r=${goalWeights.reliability.toFixed(2)}, m=${goalWeights.modularity.toFixed(2)})`);
        await this.synthesizer.run(client, config, { evalCtx, results, decision, goalWeights, wScore, wGaps, feedbackPath: input.feedbackPath });
        log.system("   ← report.md written");

        return {
            score: Math.round(wScore),
            feedback: allFeedback.join("; "),
            axes: results,
            decision,
        };
    }
}

// ── Exports ─────────────────────────────────────────────────

export const evaluatorOrchestrator = new EvaluatorOrchestrator();
export const approvalValidator = approvalValidatorInstance;

/**
 * Run a quick symbolic check (build/test) against the current working tree.
 * Returns the symbolic evaluator result. Used for post-campaign verification.
 */
export async function runSymbolicCheck(
    client: CopilotClient,
    config: AgentConfig,
    baselineSha?: string,
): Promise<EvaluatorResult> {
    const evalCtx = buildEvalContext(baselineSha);
    return symbolicEvaluator.run(client, config, evalCtx);
}
