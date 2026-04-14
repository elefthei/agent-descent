import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from "fs";

import type { GoalWeights } from "../types.js";
import { DEFAULT_GOAL_WEIGHTS } from "../types.js";

const REQUIRED_FILES = [
    ".descend/state.json",
    ".descend/implementor/goal.md",
    ".descend/evaluator/goal.md",
    ".descend/terminator/goal.md",
];

/**
 * Check if .descend/ has a valid resumable state:
 * state.json + all 3 goal files must exist.
 */
export function isValidState(): boolean {
    return REQUIRED_FILES.every((f) => existsSync(f));
}

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
    goalWeights?: GoalWeights;
}

const STATE_PATH = ".descend/state.json";

export function loadState(): DescentState | null {
    try {
        return JSON.parse(readFileSync(STATE_PATH, "utf-8"));
    } catch {
        return null;
    }
}

export function saveState(state: DescentState): void {
    mkdirSync(".descend", { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export function archiveIteration(iteration: number): void {
    const archiveDir = `.descend/history/iteration-${iteration}`;
    mkdirSync(archiveDir, { recursive: true });

    // Move current research/ and plan/ into archive (copy+delete for Windows compatibility)
    for (const dir of ["research", "plan"]) {
        const src = `.descend/${dir}`;
        const dst = `${archiveDir}/${dir}`;
        if (existsSync(src)) {
            cpSync(src, dst, { recursive: true });
            rmSync(src, { recursive: true, force: true });
            mkdirSync(src, { recursive: true });
        }
    }

    // Copy (not move) reports for historical reference
    for (const file of [
        "implementor/report.md",
        "evaluator/report.md",
    ]) {
        const src = `.descend/${file}`;
        if (existsSync(src)) {
            try {
                const content = readFileSync(src, "utf-8");
                const dir = `${archiveDir}/${file.split("/")[0]}`;
                mkdirSync(dir, { recursive: true });
                writeFileSync(`${archiveDir}/${file}`, content);
            } catch {
                // Ignore copy failures
            }
        }
    }
}

export function consecutiveRejects(history: IterationRecord[]): number {
    let count = 0;
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i]!.decision === "reject" || history[i]!.decision === "error") {
            count++;
        } else {
            break;
        }
    }
    return count;
}

/**
 * Detect if a specific axis score has been declining for `window` consecutive iterations.
 */
export function axisDeclining(history: IterationRecord[], axis: keyof AxisScoresRecord, window: number = 3): boolean {
    if (history.length < window) return false;
    const recent = history.slice(-window);
    const scores = recent.map(r => r.scores?.[axis]).filter((s): s is number => s != null);
    if (scores.length < window) return false;
    // Check strictly decreasing
    for (let i = 1; i < scores.length; i++) {
        if (scores[i]! >= scores[i - 1]!) return false;
    }
    return true;
}

/**
 * Load goal weights from state, falling back to equal weights.
 */
export function loadGoalWeights(): GoalWeights {
    const state = loadState();
    return state?.goalWeights ?? DEFAULT_GOAL_WEIGHTS;
}

/**
 * Parse goal_weights.json produced by the setup agent.
 * Validates weights sum to ~1.0 (±0.05 tolerance). Returns default on failure.
 */
export function parseGoalWeightsFile(path: string): GoalWeights {
    try {
        const raw = JSON.parse(readFileSync(path, "utf-8"));
        const f = Number(raw.features);
        const r = Number(raw.reliability);
        const m = Number(raw.modularity);
        if (isNaN(f) || isNaN(r) || isNaN(m)) return DEFAULT_GOAL_WEIGHTS;
        const sum = f + r + m;
        if (Math.abs(sum - 1.0) > 0.05) return DEFAULT_GOAL_WEIGHTS;
        return { features: f, reliability: r, modularity: m };
    } catch {
        return DEFAULT_GOAL_WEIGHTS;
    }
}
