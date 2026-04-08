import { execSync } from "child_process";

export function getGitDiff(): string {
    return execSync("git diff", { encoding: "utf-8" });
}

export function getGitDiffStaged(): string {
    return execSync("git diff --staged", { encoding: "utf-8" });
}

export function gitCommitAll(iteration: number, summary: string): void {
    execSync("git add -A");
    execSync(`git commit -m "iteration ${iteration}: ${sanitize(summary)}"`);
}

export function gitRevert(): void {
    execSync("git checkout -- .");
    execSync("git clean -fd");
}

export function gitCommitDescendOnly(
    iteration: number,
    reason: string,
): void {
    execSync("git add .descend/");
    try {
        execSync(
            `git commit -m "iteration ${iteration}: rejected — ${sanitize(reason)}"`,
        );
    } catch {
        // Nothing to commit (no changes to .descend/)
    }
}

function sanitize(msg: string): string {
    return msg.replace(/"/g, '\\"').replace(/\n/g, " ").slice(0, 200);
}
