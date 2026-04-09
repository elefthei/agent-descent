import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from "fs";
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
export function isValidState() {
    return REQUIRED_FILES.every((f) => existsSync(f));
}
const STATE_PATH = ".descend/state.json";
export function loadState() {
    try {
        return JSON.parse(readFileSync(STATE_PATH, "utf-8"));
    }
    catch {
        return null;
    }
}
export function saveState(state) {
    mkdirSync(".descend", { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}
export function archiveIteration(iteration) {
    const archiveDir = `.descend/history/iteration-${iteration}`;
    mkdirSync(archiveDir, { recursive: true });
    // Move current research/ and plan/ into archive
    for (const dir of ["research", "plan"]) {
        const src = `.descend/${dir}`;
        const dst = `${archiveDir}/${dir}`;
        if (existsSync(src)) {
            renameSync(src, dst);
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
            }
            catch {
                // Ignore copy failures
            }
        }
    }
}
export function consecutiveRejects(history) {
    let count = 0;
    for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].decision === "reject" || history[i].decision === "error") {
            count++;
        }
        else {
            break;
        }
    }
    return count;
}
export function detectStagnation(history) {
    if (history.length < 3)
        return null;
    const recent = history.slice(-3);
    // 3 consecutive rejections
    if (recent.every((r) => r.decision === "reject")) {
        return "3 consecutive rejections — implementor may be stuck";
    }
    // 3 consecutive errors
    if (recent.every((r) => r.decision === "error")) {
        return "3 consecutive errors — possible systemic issue";
    }
    // Score plateau (all have scores, <5% spread on max axis)
    const maxScores = recent.map((r) => r.scores ? Math.max(r.scores.features, r.scores.reliability, r.scores.modularity) : null).filter((s) => s != null);
    if (maxScores.length === 3) {
        const spread = Math.max(...maxScores) - Math.min(...maxScores);
        if (spread < 5) {
            return `score plateau detected (spread=${spread}, recent max scores: ${maxScores.join(", ")})`;
        }
    }
    // Score divergence (decreasing over 3 iterations)
    if (maxScores.length === 3 && maxScores[0] > maxScores[1] && maxScores[1] > maxScores[2]) {
        return `score divergence detected (${maxScores.join(" → ")})`;
    }
    return null;
}
//# sourceMappingURL=state.js.map