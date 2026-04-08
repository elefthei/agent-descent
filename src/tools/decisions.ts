import { z } from "zod";
import { defineTool } from "@github/copilot-sdk";

export interface AxisScores {
    features: number;
    reliability: number;
    modularity: number;
}

export interface AxisIssues {
    features: string[];
    reliability: string[];
    modularity: string[];
}

export interface EvaluatorDecision {
    decision: "approve" | "reject";
    summary: string;
    scores: AxisScores;
    issues: AxisIssues;
    remainingWork: string[];
    testsStatus: "pass" | "fail" | "none" | "partial";
}

export interface TerminatorDecision {
    decision: "continue" | "stop";
    reason: string;
}

const APPROVE_THRESHOLD = 50;

export function createEvaluatorDecisionTool() {
    let result: EvaluatorDecision | null = null;

    const axisScore = z.number().min(0).max(100);
    const axisIssues = z.array(z.string());

    const tool = defineTool("submit_decision", {
        description:
            "Submit your evaluation of the implementor's changes across three axes. The decision (approve/reject) is auto-derived: approve if any axis scores >= 50.",
        parameters: z.object({
            summary: z
                .string()
                .describe("Brief summary explaining your evaluation"),
            scores: z.object({
                features: axisScore.describe("0-100: New functionality, goal progress, feature completeness"),
                reliability: axisScore.describe("0-100: Testing, proofs, error handling, correctness, robustness"),
                modularity: axisScore.describe("0-100: Abstraction, clean code, refactoring, reorganization, separation of concerns"),
            }).describe("Scores across three axes"),
            issues: z.object({
                features: axisIssues.describe("Issues related to features/goal progress"),
                reliability: axisIssues.describe("Issues related to testing/reliability/correctness"),
                modularity: axisIssues.describe("Issues related to code quality/modularity/abstraction"),
            }).describe("Per-axis issue lists"),
            remainingWork: z
                .array(z.string())
                .describe("List of remaining work items to reach the goal"),
            testsStatus: z
                .enum(["pass", "fail", "none", "partial"])
                .describe("Status of tests: pass=all green, fail=failures, none=no tests, partial=some pass"),
        }),
        skipPermission: true,
        handler: async (params: {
            summary: string;
            scores: AxisScores;
            issues: AxisIssues;
            remainingWork: string[];
            testsStatus: "pass" | "fail" | "none" | "partial";
        }) => {
            const maxScore = Math.max(params.scores.features, params.scores.reliability, params.scores.modularity);
            const decision = maxScore >= APPROVE_THRESHOLD ? "approve" : "reject";
            result = { decision, ...params };
            return `Decision: ${decision} (features=${params.scores.features}, reliability=${params.scores.reliability}, modularity=${params.scores.modularity}, max=${maxScore})`;
        },
    });

    return { tool, getResult: () => result };
}

export function createTerminatorDecisionTool() {
    let result: TerminatorDecision | null = null;

    const tool = defineTool("make_decision", {
        description: "Decide whether the loop should continue or stop",
        parameters: z.object({
            decision: z
                .enum(["continue", "stop"])
                .describe("Whether to continue iterating or stop"),
            reason: z
                .string()
                .describe("Why you made this decision"),
        }),
        skipPermission: true,
        handler: async ({
            decision,
            reason,
        }: {
            decision: "continue" | "stop";
            reason: string;
        }) => {
            result = { decision, reason };
            return `Decision recorded: ${decision}`;
        },
    });

    return { tool, getResult: () => result };
}

// ── Axis Score Tool ─────────────────────────────────────────

export interface AxisResult {
    score: number;
    issues: string[];
}

export function createAxisScoreTool(axisName: string) {
    let result: AxisResult | null = null;

    const tool = defineTool("submit_axis_score", {
        description: `Submit your ${axisName} evaluation score and issues for this axis only.`,
        parameters: z.object({
            score: z
                .number()
                .min(0)
                .max(100)
                .describe(`0-100 score for the ${axisName} axis`),
            issues: z
                .array(z.string())
                .describe(`Specific issues found on the ${axisName} axis`),
        }),
        skipPermission: true,
        handler: async (params: { score: number; issues: string[] }) => {
            result = params;
            return `${axisName} score recorded: ${params.score}`;
        },
    });

    return { tool, getResult: () => result };
}

// ── Symbolic Report Tool ────────────────────────────────────

export interface SymbolicResult {
    availableChecks: string[];
    findings: string[];
    suggestions: string[];
}

export function createSymbolicReportTool() {
    let result: SymbolicResult | null = null;

    const tool = defineTool("submit_symbolic_report", {
        description: "Report what symbolic checking is available and what it found. This is guidance, not gatekeeping — no score.",
        parameters: z.object({
            availableChecks: z
                .array(z.string())
                .describe("What symbolic checks are available in this project (e.g., 'jest tests', 'typescript compiler', 'eslint', 'F* proofs', 'coverage report')"),
            findings: z
                .array(z.string())
                .describe("Issues discovered by running or inspecting symbolic checks"),
            suggestions: z
                .array(z.string())
                .describe("Suggestions for improving symbolic verification (new tests to add, proofs to write, coverage gaps)"),
        }),
        skipPermission: true,
        handler: async (params: SymbolicResult) => {
            result = params;
            return `Symbolic report recorded: ${params.availableChecks.length} checks found, ${params.findings.length} findings`;
        },
    });

    return { tool, getResult: () => result };
}
