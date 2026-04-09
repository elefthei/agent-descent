import type { CopilotClient } from "@github/copilot-sdk";
import { writeFileSync } from "fs";
import { runSetup } from "./agents/setup.js";
import {
    runImplementorResearch,
    runImplementorPlan,
    runImplementorExec,
} from "./agents/implementor.js";
import { runEvaluator, runRadicalPlan } from "./agents/evaluator.js";
import { runTerminator } from "./agents/terminator.js";
import { gitCommitAll, gitRevertToBaseline, gitCommitDescendOnly, getHeadSha, getGitDiff } from "./utils/git.js";
import { log } from "./utils/logger.js";
import { saveState, archiveIteration, detectStagnation, consecutiveRejects, type DescentState, type IterationRecord } from "./utils/state.js";
import { readFileOrDefault } from "./utils/files.js";
import { readFileSync } from "fs";

// ── Public types ────────────────────────────────────────────

export type { AgentConfig } from "./types.js";
import type { AgentConfig } from "./types.js";

export interface Agents {
    implementor: AgentConfig;
    evaluator: AgentConfig;
    terminator: AgentConfig;
}

export interface SetupOptions {
    implementorModel?: string;
    evaluatorModel?: string;
    terminatorModel?: string;
    timeout?: number;
}

export interface DescentOptions {
    goalPath?: string;
    maxIterations?: number;
    maxRetries?: number;
    maxReject?: number;
    skipResearch?: boolean;
    skipPlan?: boolean;
}

export interface DescentResult {
    iterations: number;
    converged: boolean;
    reason: string;
}

// ── setup ───────────────────────────────────────────────────

/**
 * Run the setup agent to read goal.md and project per-agent goal files into `.descend/`.
 * Returns configured agent handles for the descent loop.
 */
export async function setup(
    client: CopilotClient,
    goalPath: string,
    options?: SetupOptions,
): Promise<Agents> {
    const config: AgentConfig = {
        model: options?.implementorModel ?? "claude-opus-4.6",
        reasoningEffort: "high",
        timeout: options?.timeout,
    };
    await runSetup(client, config, goalPath);

    return {
        implementor: {
            model: options?.implementorModel ?? "claude-opus-4.6",
            reasoningEffort: "high",
            timeout: options?.timeout,
        },
        evaluator: {
            model: options?.evaluatorModel ?? "claude-opus-4.6",
            reasoningEffort: "high",
            timeout: options?.timeout,
        },
        terminator: {
            model: options?.terminatorModel ?? "claude-opus-4.6",
            reasoningEffort: "high",
            timeout: options?.timeout,
        },
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
    const maxReject = options?.maxReject ?? 3;
    let baseline = getHeadSha();

    const state: DescentState = {
        iteration: 0,
        baselineCommit: baseline,
        phase: "init",
        history: [],
    };
    saveState(state);

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
        log.system(`\n${"═".repeat(60)}`);
        log.system(`  Iteration ${iteration} / ${maxIterations}`);
        log.system(`${"═".repeat(60)}\n`);

        // Archive previous iteration's artifacts to prevent prompt contamination
        if (iteration > 1) {
            archiveIteration(iteration - 1);
        }

        state.iteration = iteration;
        state.phase = "implementor:research";
        saveState(state);

        try {
            // Implementor: Research → Plan → Execute
            const implRetries = agents.implementor.retryBudget ?? maxRetries;

            if (!options?.skipResearch) {
                log.system("📚 Implementor: Research phase...");
                await withRetry(
                    () => runImplementorResearch(client, agents.implementor),
                    implRetries,
                );

                state.phase = "implementor:plan";
                saveState(state);
            }

            if (!options?.skipPlan) {
                log.system("📋 Implementor: Plan phase...");
                await withRetry(
                    () => runImplementorPlan(client, agents.implementor),
                    implRetries,
                );

                state.phase = "implementor:exec";
                saveState(state);
            }

            log.system("🔧 Implementor: Execute phase...");
            await withRetry(
                () => runImplementorExec(client, agents.implementor),
                implRetries,
            );

            // Evaluator: Review + decide (diff against baseline for owned changes only)
            state.phase = "evaluator";
            saveState(state);

            log.system("🔍 Evaluator: Reviewing changes...");
            const evalResult = await withRetry(
                () => runEvaluator(client, agents.evaluator, baseline),
                agents.evaluator.retryBudget ?? maxRetries,
            );

            const record: IterationRecord = {
                iteration,
                decision: evalResult.decision === "approve" ? "approve" : "reject",
                scores: evalResult.scores,
                summary: evalResult.summary,
            };

            const { features, reliability, modularity } = evalResult.scores;
            if (evalResult.decision === "approve") {
                log.system(`✅ Evaluator APPROVED: ${evalResult.summary}`);
                log.system(`   Scores: features=${features}, reliability=${reliability}, modularity=${modularity}`);
                gitCommitAll(iteration, evalResult.summary);
                baseline = getHeadSha();
            } else {
                log.system(`❌ Evaluator REJECTED: ${evalResult.summary}`);
                log.system(`   Scores: features=${features}, reliability=${reliability}, modularity=${modularity}`);
                gitRevertToBaseline(baseline);
                gitCommitDescendOnly(iteration, evalResult.summary);
                baseline = getHeadSha();
            }

            state.baselineCommit = baseline;
            state.history.push(record);
            saveState(state);

            // Check for stagnation patterns
            const warning = detectStagnation(state.history);
            if (warning) {
                log.system(`⚠️ Stagnation warning: ${warning}`);
            }

            // RADICAL PLAN: if too many consecutive rejections, evaluator does deep planning
            const rejectStreak = consecutiveRejects(state.history);
            if (rejectStreak >= maxReject && options?.goalPath) {
                log.system(`\n🚨 ${rejectStreak} consecutive rejections — entering RADICAL PLAN mode...`);
                state.phase = "evaluator:radical";
                saveState(state);

                // Collect evaluator reports from the last N rejected iterations
                const failureReports: string[] = [];
                const recentRejects = state.history.slice(-rejectStreak);
                for (const rec of recentRejects) {
                    const archived = readFileOrDefault(
                        `.descend/history/iteration-${rec.iteration}/evaluator/report.md`,
                        "",
                    );
                    // Fall back to current report for the most recent iteration
                    const report = archived || readFileOrDefault(".descend/evaluator/report.md", "");
                    if (report) failureReports.push(report);
                }

                const goalContent = readFileSync(options.goalPath, "utf-8");
                await withRetry(
                    () => runRadicalPlan(client, agents.evaluator, goalContent, failureReports),
                    agents.evaluator.retryBudget ?? maxRetries,
                );

                log.system("📋 RADICAL PLAN written to .descend/evaluator/report.md");
            }

            // Terminator: Continue or stop?
            state.phase = "terminator";
            saveState(state);

            log.system("🎯 Terminator: Checking convergence...");
            const termResult = await withRetry(
                () => runTerminator(client, agents.terminator, {
                    evalDecision: evalResult,
                    history: state.history,
                }),
                agents.terminator.retryBudget ?? maxRetries,
            );

            if (termResult.decision === "stop") {
                state.phase = "done";
                saveState(state);
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
            gitRevertToBaseline(baseline);
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
            baseline = getHeadSha();

            state.baselineCommit = baseline;
            state.history.push({ iteration, decision: "error", summary: message });
            saveState(state);

            const warning = detectStagnation(state.history);
            if (warning) {
                log.system(`⚠️ Stagnation warning: ${warning}`);
            }
        }
    }

    state.phase = "done";
    saveState(state);
    log.system(`\n⚠️ Reached maximum iterations (${maxIterations}). Stopping.`);
    return { iterations: maxIterations, converged: false, reason: "max iterations reached" };
}

// ── internal ────────────────────────────────────────────────

const RETRY_BACKOFF_MS = 30_000; // 30s between retries for API recovery

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatError(err: Error): string {
    const msg = err.message;
    if (msg.includes("Timeout") && msg.includes("waiting for session.idle")) {
        return "⏱️ Agent session timed out. Try --timeout M for longer sessions.";
    }
    if (msg.includes("Failed to get response from the AI model")) {
        return "🌐 AI model API error (rate limit or outage). Will retry after backoff.";
    }
    return msg;
}

async function withRetry<T>(fn: () => Promise<T>, retries: number): Promise<T> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            if (attempt === retries) throw err;
            const friendly = formatError(err as Error);
            log.system(
                `⚠️ Attempt ${attempt + 1} failed: ${friendly}`,
            );
            log.system(`   Waiting ${RETRY_BACKOFF_MS / 1000}s before retry...`);
            await sleep(RETRY_BACKOFF_MS);
        }
    }
    throw new Error("Unreachable");
}
