import { execFileSync } from "child_process";

export function getGitDiff(base?: string): string {
    const args = base ? ["diff", base] : ["diff"];
    return execFileSync("git", args, { encoding: "utf-8" });
}

export function getHeadSha(): string {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).trim();
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
    try {
        execFileSync("git", ["add", ".descend/"]);
    } catch {
        // .descend/ may be gitignored — warn and skip
        console.error(
            "⚠️  Cannot track .descend/ — it may be in .gitignore. Remove '.descend' from .gitignore for agent-descent to work correctly.",
        );
        return;
    }
    try {
        execFileSync("git", ["commit", "-m", `iteration ${iteration}: rejected — ${reason.slice(0, 200)}`]);
    } catch {
        // Nothing to commit (no changes to .descend/)
    }
}
