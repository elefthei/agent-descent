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
export declare function createTerminatorDecisionTool(): {
    tool: import("@github/copilot-sdk").Tool<{
        decision: "continue" | "stop";
        reason: string;
    }>;
    getResult: () => TerminatorDecision | null;
};
export interface AxisResult {
    score: number;
    issues: string[];
}
export declare function createAxisScoreTool(axisName: string): {
    tool: import("@github/copilot-sdk").Tool<{
        score: number;
        issues: string[];
    }>;
    getResult: () => AxisResult | null;
};
export interface SymbolicResult {
    availableChecks: string[];
    findings: string[];
    suggestions: string[];
}
export declare function createSymbolicReportTool(): {
    tool: import("@github/copilot-sdk").Tool<{
        availableChecks: string[];
        findings: string[];
        suggestions: string[];
    }>;
    getResult: () => SymbolicResult | null;
};
