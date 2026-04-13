#!/usr/bin/env npx tsx
/**
 * Summarize an agent-descent session.log using the Copilot SDK.
 *
 * Usage: npx tsx scripts/summarize-log.ts <session.log>
 *        → writes <session.log>.summary
 */

import { readFileSync, writeFileSync } from "fs";
import { CopilotClient, approveAll } from "@github/copilot-sdk";

// ── Parse log into agent sections ───────────────────────────

interface Section {
    agent: string;
    lines: string[];
    iteration?: number;
}

function parseSections(logContent: string): Section[] {
    const lines = logContent.split("\n");
    const sections: Section[] = [];
    let current: Section | null = null;
    let currentIteration = 0;

    const agentRegex = /^\[([^\]]+)\]/;

    for (const line of lines) {
        // Track iteration boundaries
        const iterMatch = line.match(/Iteration (\d+) \//);
        if (iterMatch) {
            currentIteration = parseInt(iterMatch[1]!, 10);
        }

        const match = line.match(agentRegex);
        if (!match) continue;

        const agent = match[1]!.trim();

        // Skip system lines (they're orchestrator noise)
        if (agent === "system") continue;

        if (!current || current.agent !== agent) {
            // New agent section
            if (current && current.lines.length > 0) {
                sections.push(current);
            }
            current = { agent, lines: [], iteration: currentIteration };
        }

        current.lines.push(line);
    }

    if (current && current.lines.length > 0) {
        sections.push(current);
    }

    return sections;
}

// ── Summarize each section via Copilot SDK ──────────────────

async function summarizeSection(
    client: CopilotClient,
    section: Section,
): Promise<string> {
    // Truncate large sections to avoid context overflow
    const maxChars = 8000;
    let content = section.lines.join("\n");
    if (content.length > maxChars) {
        const head = content.slice(0, maxChars / 2);
        const tail = content.slice(-maxChars / 2);
        content = head + "\n\n... (truncated) ...\n\n" + tail;
    }

    const session = await client.createSession({
        model: "claude-opus-4.6",
        reasoningEffort: "low",
        systemMessage: {
            mode: "replace",
            content: "Summarize this agent's activity in 2-3 sentences. Be concise and high-level. Focus on: what it did, what it produced, and whether it succeeded. If there are scores, include them. If there are errors, mention them briefly.",
        },
        onPermissionRequest: approveAll,
        infiniteSessions: { enabled: false },
    });

    const reply = await session.sendAndWait({
        prompt: `Agent: ${section.agent}\nLines: ${section.lines.length}\n\n${content}`,
    }, 60_000);

    await session.disconnect();
    await client.deleteSession(session.sessionId);

    return reply?.data.content ?? "(no summary)";
}

// ── Main ────────────────────────────────────────────────────

async function main() {
    const logPath = process.argv[2];
    if (!logPath) {
        console.error("Usage: npx tsx scripts/summarize-log.ts <session.log>");
        process.exit(1);
    }

    const outputPath = logPath + ".summary";
    console.log(`Parsing ${logPath}...`);

    const logContent = readFileSync(logPath, "utf-8");
    const sections = parseSections(logContent);
    console.log(`Found ${sections.length} agent sections.`);

    const client = new CopilotClient({ logLevel: "none" });
    await client.start();

    const output: string[] = ["# Session Log Summary\n"];
    let lastIteration = 0;

    try {
        for (let i = 0; i < sections.length; i++) {
            const section = sections[i]!;

            // Iteration header
            if (section.iteration && section.iteration !== lastIteration) {
                lastIteration = section.iteration;
                output.push(`\n## Iteration ${lastIteration}\n`);
            }

            process.stdout.write(`  [${i + 1}/${sections.length}] ${section.agent} (${section.lines.length} lines)...`);

            try {
                const summary = await summarizeSection(client, section);
                output.push(`### ${section.agent}`);
                output.push(summary);
                output.push("");
                console.log(" ✓");
            } catch (err) {
                output.push(`### ${section.agent}`);
                output.push(`(summarization failed: ${(err as Error).message})`);
                output.push("");
                console.log(` ✗ ${(err as Error).message}`);
            }
        }
    } finally {
        await client.stop();
    }

    writeFileSync(outputPath, output.join("\n"));
    console.log(`\nSummary written to ${outputPath}`);
}

main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
});
