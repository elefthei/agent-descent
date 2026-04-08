import { readFileSync, writeFileSync, mkdirSync } from "fs";

export interface ParsedGoal {
    goalToImplement: string;
    progressMetric: string;
    terminationCondition: string;
}

export function parseGoalFile(goalPath: string): ParsedGoal {
    const content = readFileSync(goalPath, "utf-8");

    // Support two formats:
    //   New: "## Goal", "## Metric", "## Done"
    //   Legacy: "## Goal to implement", "## Progress metric", "## Termination condition"
    const goalToImplement =
        extractSection(content, "Goal") ??
        extractSection(content, "Goal to implement") ??
        fail("goal.md missing required section: ## Goal");

    const progressMetric =
        extractSection(content, "Metric") ??
        extractSection(content, "Progress metric") ??
        fail("goal.md missing required section: ## Metric");

    const terminationCondition =
        extractSection(content, "Done") ??
        extractSection(content, "Termination condition") ??
        fail("goal.md missing required section: ## Done");

    return { goalToImplement, progressMetric, terminationCondition };
}

function extractSection(content: string, heading: string): string | null {
    const regex = new RegExp(
        `##\\s*${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
        "i",
    );
    const match = content.match(regex);
    return match ? match[1]!.trim() : null;
}

function fail(msg: string): never {
    throw new Error(msg);
}

export function projectGoalFiles(parsed: ParsedGoal): void {
    mkdirSync(".descend/implementor", { recursive: true });
    mkdirSync(".descend/evaluator", { recursive: true });
    mkdirSync(".descend/terminator", { recursive: true });

    writeFileSync(
        ".descend/implementor/goal.md",
        [
            "# Implementor Goal",
            "",
            "## What to build",
            parsed.goalToImplement,
        ].join("\n"),
    );

    writeFileSync(
        ".descend/evaluator/goal.md",
        [
            "# Evaluator Goal",
            "",
            "## What to evaluate against",
            parsed.goalToImplement,
            "",
            "## Progress metric",
            parsed.progressMetric,
        ].join("\n"),
    );

    writeFileSync(
        ".descend/terminator/goal.md",
        [
            "# Terminator Goal",
            "",
            "## Termination condition",
            parsed.terminationCondition,
            "",
            "## Progress metric",
            parsed.progressMetric,
        ].join("\n"),
    );
}
