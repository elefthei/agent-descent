import type { CopilotClient } from "@github/copilot-sdk";
import { writeFileSync } from "fs";
import { runSetup } from "./agents/setup.js";
import {
    runImplementorResearch,
    runImplementorPlan,
    runImplementorExec,
} from "./agents/implementor.js";
import { runEvaluator } from "./agents/evaluator.js";
import { runTerminator } from "./agents/terminator.js";
import { gitCommitAll, gitRevert, gitCommitDescendOnly } from "./utils/git.js";
import { log } from "./utils/logger.js";

// ── Public types ────────────────────────────────────────────

export interface AgentConfig {
    model: string;
}

export interface Agents {
    implementor: AgentConfig;
    evaluator: AgentConfig;
    terminator: AgentConfig;
}

export interface SetupOptions {
    implementorModel?: string;
    evaluatorModel?: string;
    terminatorModel?: string;
}

export interface DescentOptions {
    maxIterations?: number;
    maxRetries?: number;
}

export interface DescentResult {
    iterations: number;
    converged: boolean;
    reason: string;
}

// ── setup ───────────────────────────────────────────────────

/**
 * Parse goal.md and project per-agent goal files into `.descend/`.
 * Returns configured agent handles for the descent loop.
 */
export function setup(goalPath: string, options?: SetupOptions): Agents {
    runSetup(goalPath);

    return {
        implementor: { model: options?.implementorModel ?? "claude-sonnet-4.5" },
        evaluator: { model: options?.evaluatorModel ?? "claude-sonnet-4.5" },
        terminator: { model: options?.terminatorModel ?? "gpt-4.1" },
    };
}

// ── descent ─────────────────────────────────────────────────

/**
 * Run the agent descent loop: Implementor → Evaluator → Terminator → repeat.
 * Returns when the terminator says STOP or maxIterations is reached.
 */
export async function descent(
    client: CopilotClient,
    agents: Agents,
    options?: DescentOptions,
): Promise<DescentResult> {
    const maxIterations = options?.maxIterations ?? 10;
    const maxRetries = options?.maxRetries ?? 2;

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
        log.system(`\n${"═".repeat(60)}`);
        log.system(`  Iteration ${iteration} / ${maxIterations}`);
        log.system(`${"═".repeat(60)}\n`);

        try {
            // Implementor: Research → Plan → Execute
            log.system("📚 Implementor: Research phase...");
            await withRetry(
                () => runImplementorResearch(client, agents.implementor),
                maxRetries,
            );

            log.system("📋 Implementor: Plan phase...");
            await withRetry(
                () => runImplementorPlan(client, agents.implementor),
                maxRetries,
            );

            log.system("🔧 Implementor: Execute phase...");
            await withRetry(
                () => runImplementorExec(client, agents.implementor),
                maxRetries,
            );

            // Evaluator: Review + decide
            log.system("🔍 Evaluator: Reviewing changes...");
            const evalResult = await withRetry(
                () => runEvaluator(client, agents.evaluator),
                maxRetries,
            );

            if (evalResult.decision === "approve") {
                log.system(`✅ Evaluator APPROVED: ${evalResult.summary}`);
                gitCommitAll(iteration, evalResult.summary);
            } else {
                log.system(`❌ Evaluator REJECTED: ${evalResult.summary}`);
                gitRevert();
                gitCommitDescendOnly(iteration, evalResult.summary);
            }

            // Terminator: Continue or stop?
            log.system("🎯 Terminator: Checking convergence...");
            const termResult = await withRetry(
                () => runTerminator(client, agents.terminator),
                maxRetries,
            );

            if (termResult.decision === "stop") {
                log.system(
                    `\n🏁 Converged after ${iteration} iteration(s): ${termResult.reason}`,
                );
                return { iterations: iteration, converged: true, reason: termResult.reason };
            }

            log.system(`🔄 Continuing: ${termResult.reason}`);
        } catch (err) {
            const message = (err as Error).message;
            log.system(
                `⚠️ Iteration ${iteration} failed after retries: ${message}`,
            );
            gitRevert();
            writeFileSync(
                ".descend/evaluator/report.md",
                [
                    "# Error Report",
                    "",
                    `Iteration ${iteration} failed: ${message}`,
                    "",
                    "The implementor should retry the previous approach or try a different strategy.",
                ].join("\n"),
            );
            gitCommitDescendOnly(iteration, `error: ${message}`);
        }
    }

    log.system(`\n⚠️ Reached maximum iterations (${maxIterations}). Stopping.`);
    return { iterations: maxIterations, converged: false, reason: "max iterations reached" };
}

// ── internal ────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, retries: number): Promise<T> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            if (attempt === retries) throw err;
            log.system(
                `⚠️ Attempt ${attempt + 1} failed: ${(err as Error).message}. Retrying...`,
            );
        }
    }
    throw new Error("Unreachable");
}
