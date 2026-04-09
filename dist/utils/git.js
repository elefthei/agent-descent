import { execFileSync } from "child_process";
export function getGitDiff(base) {
    // Stage everything first so new/untracked files appear in the diff
    execFileSync("git", ["add", "-A"]);
    const args = base ? ["diff", "--staged", base] : ["diff", "--staged"];
    const diff = execFileSync("git", args, { encoding: "utf-8" });
    // Unstage so the evaluator's approve/reject flow controls the final commit
    execFileSync("git", ["reset", "HEAD"], { stdio: "ignore" });
    return diff;
}
export function getHeadSha() {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).trim();
}
export function gitCommitAll(iteration, summary) {
    execFileSync("git", ["add", "-A"]);
    execFileSync("git", ["commit", "-m", `iteration ${iteration}: ${summary.slice(0, 200)}`]);
}
export function gitRevertToBaseline(baselineSha) {
    execFileSync("git", ["checkout", baselineSha, "--", "."]);
    execFileSync("git", ["clean", "-fd"]);
}
export function gitCommitDescendOnly(iteration, reason) {
    execFileSync("git", ["add", ".descend/"]);
    try {
        execFileSync("git", ["commit", "-m", `iteration ${iteration}: rejected — ${reason.slice(0, 200)}`]);
    }
    catch {
        // Nothing to commit (no changes to .descend/)
    }
}
//# sourceMappingURL=git.js.map