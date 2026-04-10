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

// ── Implementor Result Tool ─────────────────────────────────

import type { ImplementorKind } from "../types.js";

export function createImplementorResultTool() {
    const box = { result: null as { kinds: string[]; feedback: string } | null };

    const tool = defineTool("submit_implementor_result", {
        description: "Submit a summary of what this implementation phase accomplished.",
        parameters: z.object({
            kinds: z
                .array(z.enum(["Research", "Plan", "Feature", "Reliability", "Refactor"]))
                .describe("What this iteration targeted: Research, Plan, Feature, Reliability, Refactor (can be multiple)"),
            feedback: z
                .string()
                .describe("Brief summary of what was accomplished"),
        }),
        skipPermission: true,
        handler: async (params: { kinds: string[]; feedback: string }) => {
            box.result = params;
            return `Result recorded: ${params.kinds.join(", ")}`;
        },
    });

    return {
        tool,
        getResult: () => box.result ? {
            kinds: new Set(box.result.kinds as ImplementorKind[]),
            feedback: box.result.feedback,
        } : null,
    };
}
