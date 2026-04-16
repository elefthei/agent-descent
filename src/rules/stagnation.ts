/**
 * Stagnation detection rules — detect when the descent loop is stuck.
 * SUCCESS = stagnation detected, CONTINUE = not enough data, FAILURE = healthy.
 */

import { Gate, type Rule } from "../rules.js";
import type { IterationRecord } from "../utils/state.js";

const threeConsecutiveRejects: Rule<IterationRecord[]> = Gate.lift((history) => {
    if (history.length < 3) return "CONTINUE";
    return Gate.fromBool(history.slice(-3).every((r) => r.decision === "reject"));
});

const threeConsecutiveErrors: Rule<IterationRecord[]> = Gate.lift((history) => {
    if (history.length < 3) return "CONTINUE";
    return Gate.fromBool(history.slice(-3).every((r) => r.decision === "error"));
});

const scorePlateau: Rule<IterationRecord[]> = Gate.lift((history) => {
    if (history.length < 3) return "CONTINUE";
    const maxScores = history.slice(-3)
        .map((r) => r.scores ? Math.max(r.scores.features, r.scores.reliability, r.scores.modularity) : null)
        .filter((s): s is number => s != null);
    if (maxScores.length < 3) return "CONTINUE";
    return Gate.fromBool(Math.max(...maxScores) - Math.min(...maxScores) < 5);
});

const scoreDivergence: Rule<IterationRecord[]> = Gate.lift((history) => {
    if (history.length < 3) return "CONTINUE";
    const maxScores = history.slice(-3)
        .map((r) => r.scores ? Math.max(r.scores.features, r.scores.reliability, r.scores.modularity) : null)
        .filter((s): s is number => s != null);
    if (maxScores.length < 3) return "CONTINUE";
    return Gate.fromBool(maxScores[0]! > maxScores[1]! && maxScores[1]! > maxScores[2]!);
});

export const stagnationRule: Rule<IterationRecord[]> = Gate.or(
    threeConsecutiveRejects,
    threeConsecutiveErrors,
    scorePlateau,
    scoreDivergence,
);

export async function checkStagnation(history: IterationRecord[]): Promise<string | null> {
    const result = await stagnationRule(history);
    if (result !== "SUCCESS") return null;

    if (await threeConsecutiveRejects(history) === "SUCCESS") return "3 consecutive rejections — implementor may be stuck";
    if (await threeConsecutiveErrors(history) === "SUCCESS") return "3 consecutive errors — possible systemic issue";
    if (await scorePlateau(history) === "SUCCESS") return "score plateau detected (<5-point spread over last 3 iterations)";
    if (await scoreDivergence(history) === "SUCCESS") return "score divergence detected (decreasing over last 3 iterations)";
    return "stagnation detected";
}
