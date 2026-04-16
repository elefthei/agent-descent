import { execFileSync } from "child_process";

export function getGitDiff(base?: string): string {
    // Stage everything first so new/untracked files appear in the diff
    execFileSync("git", ["add", "-A"]);
    const args = base ? ["diff", "--staged", base] : ["diff", "--staged"];
    const diff = execFileSync("git", args, { encoding: "utf-8" });
    // Unstage so the evaluator's approve/reject flow controls the final commit
    execFileSync("git", ["reset", "HEAD"], { stdio: "ignore" });
    return diff;
}

export function getHeadSha(): string {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).trim();
}

export function getGitLog(maxCount: number = 20): string {
    return execFileSync("git", ["log", "--oneline", `-${maxCount}`], { encoding: "utf-8" }).trim();
}

export function gitCommitAll(iteration: number, summary: string): void {
    execFileSync("git", ["add", "-A"]);
    execFileSync("git", ["commit", "-m", `iteration ${iteration}: ${summary.slice(0, 200)}`]);
}

export function gitRevertToBaseline(baselineSha: string): void {
    execFileSync("git", ["checkout", baselineSha, "--", "."]);
    execFileSync("git", ["clean", "-fd"]);
}

export function gitCommitDescendOnly(
    iteration: number,
    reason: string,
): void {
    execFileSync("git", ["add", ".descend/"]);
    try {
        execFileSync("git", ["commit", "-m", `iteration ${iteration}: rejected — ${reason.slice(0, 200)}`]);
    } catch {
        // Nothing to commit (no changes to .descend/)
    }
}
