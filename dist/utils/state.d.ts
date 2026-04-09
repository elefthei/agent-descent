/**
 * Check if .descend/ has a valid resumable state:
 * state.json + all 3 goal files must exist.
 */
export declare function isValidState(): boolean;
export interface AxisScoresRecord {
    features: number;
    reliability: number;
    modularity: number;
}
export interface IterationRecord {
    iteration: number;
    decision: "approve" | "reject" | "error";
    scores?: AxisScoresRecord;
    summary: string;
}
export interface DescentState {
    iteration: number;
    baselineCommit: string;
    phase: string;
    history: IterationRecord[];
}
export declare function loadState(): DescentState | null;
export declare function saveState(state: DescentState): void;
export declare function archiveIteration(iteration: number): void;
export declare function consecutiveRejects(history: IterationRecord[]): number;
export declare function detectStagnation(history: IterationRecord[]): string | null;
