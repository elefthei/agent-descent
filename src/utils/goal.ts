import { readFileSync, writeFileSync, mkdirSync } from "fs";

export interface ParsedGoal {
    goalToImplement: string;
    progressMetric: string;
    terminationCondition: string;
}

export function parseGoalFile(goalPath: string): ParsedGoal {
    const content = readFileSync(goalPath, "utf-8");
    const sections = extractSections(content, [
        "Goal to implement",
        "Progress metric",
        "Termination condition",
    ]);
    return {
        goalToImplement: sections["Goal to implement"]!,
        progressMetric: sections["Progress metric"]!,
        terminationCondition: sections["Termination condition"]!,
    };
}

function extractSections(
    content: string,
    headings: string[],
): Record<string, string> {
    const result: Record<string, string> = {};
    for (const heading of headings) {
        const regex = new RegExp(
            `##\\s*${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
            "i",
        );
        const match = content.match(regex);
        if (!match) {
            throw new Error(
                `goal.md missing required section: "## ${heading}"`,
            );
        }
        result[heading] = match[1]!.trim();
    }
    return result;
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
