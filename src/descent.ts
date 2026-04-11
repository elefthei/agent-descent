import type { CopilotClient } from "@github/copilot-sdk";
import { writeFileSync } from "fs";
import { runSetup } from "./agents/setup.js";
import {
    runImplementorResearch,
    runImplementorPlan,
    runImplementorExec,
} from "./agents/implementor.js";
import { runEvaluator, runRadicalPlan, evaluateTerminator } from "./agents/evaluator.js";
import { runTerminator } from "./agents/terminator.js";
import { runReliabilityCampaign } from "./agents/campaigns/reliability.js";
import { runModularityCampaign } from "./agents/campaigns/modularity.js";
import { gitCommitAll, gitRevertToBaseline, gitCommitDescendOnly, getHeadSha, getGitDiff } from "./utils/git.js";
import { log } from "./utils/logger.js";
import { saveState, loadState, archiveIteration, detectStagnation, consecutiveRejects, isValidState, type DescentState, type IterationRecord } from "./utils/state.js";
import { readFileOrDefault } from "./utils/files.js";
import { readFileSync } from "fs";
import { DEFAULT_MODEL, getNextModel, isRateLimitError } from "./models.js";
import { checkPreviousError } from "./utils/check-error.js";

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
 * Initialize or resume the descent loop.
 * If .descend/ has valid state (state.json + 3 goal files), skip setup and resume.
 * Otherwise, run the setup agent to project goal.md into per-agent goal files.
 */
export async function setup(
    client: CopilotClient,
    goalPath: string,
    options?: SetupOptions,
): Promise<Agents> {
    const agents: Agents = {
        implementor: {
            model: options?.implementorModel ?? DEFAULT_MODEL,
            reasoningEffort: "high",
            timeout: options?.timeout,
        },
        evaluator: {
            model: options?.evaluatorModel ?? DEFAULT_MODEL,
            reasoningEffort: "high",
            timeout: options?.timeout,
        },
        terminator: {
            model: options?.terminatorModel ?? DEFAULT_MODEL,
            reasoningEffort: "high",
            timeout: options?.timeout,
        },
    };

    if (isValidState()) {
        const state = loadState();
        const prevIterations = state?.history.length ?? 0;
        log.system(`♻️  Resuming — .descend/ has valid state (${prevIterations} previous iteration(s))`);
        return agents;
    }

    // Fresh start — setup agent projects goal.md
    const config: AgentConfig = {
        model: options?.implementorModel ?? DEFAULT_MODEL,
        reasoningEffort: "high",
        timeout: options?.timeout,
    };
    await runSetup(client, config, goalPath);

    return agents;
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

    // Resume from existing state or start fresh
    const existingState = loadState();
    let startIteration: number;
    let baseline: string;

    if (existingState) {
        baseline = existingState.baselineCommit;
        const lastPhase = existingState.phase;

        if (lastPhase === "done" || lastPhase === "init") {
            // Clean boundary — start next iteration
            startIteration = existingState.history.length + 1;
        } else {
            // Interrupted mid-iteration — revert and redo this iteration
            log.system(`⚠️ Previous run interrupted during phase: ${lastPhase}`);
            log.system(`   Reverting to baseline and restarting iteration ${existingState.iteration}`);
            gitRevertToBaseline(baseline);
            // Remove partial iteration record if it was added
            if (existingState.history.length > 0 &&
                existingState.history[existingState.history.length - 1]!.iteration === existingState.iteration) {
                existingState.history.pop();
            }
            startIteration = existingState.iteration > 0 ? existingState.iteration : 1;
        }
    } else {
        baseline = getHeadSha();
        startIteration = 1;
    }

    const state: DescentState = existingState ?? {
        iteration: 0,
        baselineCommit: baseline,
        phase: "init",
        history: [],
    };
    saveState(state);

    if (startIteration > 1) {
        log.system(`♻️  Continuing from iteration ${startIteration} (${state.history.length} previous)`);
    }

    for (let iteration = startIteration; iteration <= maxIterations; iteration++) {
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

            // Check if evaluator's report from previous iteration has a system error
            if (await checkPreviousError(client, agents.evaluator, ".descend/evaluator/report.md")) {
                log.system("⚠️ Evaluator report contains system error — re-running evaluator");
                await withRetry(
                    (cfg) => runEvaluator(client, cfg, baseline),
                    agents.evaluator,
                    agents.evaluator.retryBudget ?? maxRetries,
                );
            }

            if (!options?.skipResearch) {
                log.system("📚 Implementor: Research phase...");
                const researchResult = await withRetry(
                    (cfg) => runImplementorResearch(client, cfg),
                    agents.implementor,
                    implRetries,
                );
                log.system(`   ← research: [${[...researchResult.kinds].join(", ")}] ${researchResult.feedback}`);

                state.phase = "implementor:plan";
                saveState(state);
            }

            if (!options?.skipPlan) {
                log.system("📋 Implementor: Plan phase...");
                const planResult = await withRetry(
                    (cfg) => runImplementorPlan(client, cfg),
                    agents.implementor,
                    implRetries,
                );
                log.system(`   ← plan: [${[...planResult.kinds].join(", ")}] ${planResult.feedback}`);

                state.phase = "implementor:exec";
                saveState(state);
            }

            log.system("🔧 Implementor: Execute phase...");
            const execResult = await withRetry(
                (cfg) => runImplementorExec(client, cfg),
                agents.implementor,
                implRetries,
            );
            log.system(`   ← exec: [${[...execResult.kinds].join(", ")}] ${execResult.feedback}`);

            // Evaluator: Review + decide (diff against baseline for owned changes only)
            state.phase = "evaluator";
            saveState(state);

            // Check if implementor's report has a system error
            if (await checkPreviousError(client, agents.implementor, ".descend/implementor/report.md")) {
                log.system("⚠️ Implementor report contains system error — re-running implementor:exec");
                await withRetry(
                    (cfg) => runImplementorExec(client, cfg),
                    agents.implementor,
                    implRetries,
                );
            }

            log.system("🔍 Evaluator: Reviewing changes...");
            const evalResult = await withRetry(
                (cfg) => runEvaluator(client, cfg, baseline),
                agents.evaluator,
                agents.evaluator.retryBudget ?? maxRetries,
            );

            const record: IterationRecord = {
                iteration,
                decision: evalResult.decision,
                scores: {
                    features: evalResult.axes.get("features")?.score ?? 0,
                    reliability: evalResult.axes.get("reliability")?.score ?? 0,
                    modularity: evalResult.axes.get("modularity")?.score ?? 0,
                },
                summary: evalResult.feedback,
            };

            const scoreStr = [...evalResult.axes.entries()]
                .filter(([n]) => n !== "symbolic")
                .map(([n, r]) => `${n}=${r.score}`)
                .join(", ");

            if (evalResult.decision === "approve") {
                log.system(`✅ Evaluator APPROVED (score=${evalResult.score})`);
                log.system(`   ${scoreStr}`);
                gitCommitAll(iteration, evalResult.feedback);
                baseline = getHeadSha();
            } else {
                log.system(`❌ Evaluator REJECTED (score=${evalResult.score})`);
                log.system(`   ${scoreStr}`);
                gitRevertToBaseline(baseline);
                gitCommitDescendOnly(iteration, evalResult.feedback);
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

            // RADICAL PLAN ESCALATION: after N consecutive rejections
            // Step 1: Reliability campaign → Step 2: Modularity campaign → Step 3: Radical plan
            const rejectStreak = consecutiveRejects(state.history);
            if (rejectStreak >= maxReject) {
                log.system(`\n🚨 ${rejectStreak} consecutive rejections — escalating...`);

                // Step 1: Reliability campaign
                log.system("   Step 1/3: 🛡️ Reliability campaign (tests/proofs)...");
                state.phase = "campaign:reliability";
                saveState(state);
                const relResult = await withRetry(
                    (cfg) => runReliabilityCampaign(client, cfg),
                    agents.implementor,
                    agents.implementor.retryBudget ?? maxRetries,
                );
                log.system(`   ← [${[...relResult.kinds].join(", ")}] ${relResult.feedback}`);

                // Step 2: Modularity campaign
                log.system("   Step 2/3: 🏗️ Modularity campaign (refactoring)...");
                state.phase = "campaign:modularity";
                saveState(state);
                const modResult = await withRetry(
                    (cfg) => runModularityCampaign(client, cfg),
                    agents.implementor,
                    agents.implementor.retryBudget ?? maxRetries,
                );
                log.system(`   ← [${[...modResult.kinds].join(", ")}] ${modResult.feedback}`);

                // Step 3: Radical plan (rethink from goal.md + failure history)
                if (options?.goalPath) {
                    log.system("   Step 3/3: 🚨 Radical plan (rethink from goal.md)...");
                    state.phase = "evaluator:radical";
                    saveState(state);

                    const failureReports: string[] = [];
                    const recentRejects = state.history.slice(-rejectStreak);
                    for (const rec of recentRejects) {
                        const archived = readFileOrDefault(
                            `.descend/history/iteration-${rec.iteration}/evaluator/report.md`,
                            "",
                        );
                        const report = archived || readFileOrDefault(".descend/evaluator/report.md", "");
                        if (report) failureReports.push(report);
                    }

                    const goalContent = readFileSync(options.goalPath, "utf-8");
                    await withRetry(
                        (cfg) => runRadicalPlan(client, cfg, goalContent, failureReports),
                        agents.evaluator,
                        agents.evaluator.retryBudget ?? maxRetries,
                    );
                    log.system("   📋 RADICAL PLAN written to .descend/evaluator/report.md");
                }
            }

            // Terminator: Continue or stop?
            state.phase = "terminator";
            saveState(state);

            // Check if evaluator's report has a system error
            if (await checkPreviousError(client, agents.evaluator, ".descend/evaluator/report.md")) {
                log.system("⚠️ Evaluator report contains system error — re-running evaluator");
                const retryEval = await withRetry(
                    (cfg) => runEvaluator(client, cfg, baseline),
                    agents.evaluator,
                    agents.evaluator.retryBudget ?? maxRetries,
                );
                // Update evalResult for the terminator
                Object.assign(evalResult, retryEval);
            }

            log.system("🎯 Terminator: Checking convergence...");

            // Rule-based pre-check (fast, deterministic)
            const ruleResult = evaluateTerminator(evalResult.axes, state.history, iteration);
            log.system(`   Rule check: ${ruleResult.result} — ${ruleResult.feedback}`);

            if (ruleResult.result === "SUCCESS") {
                state.phase = "done";
                saveState(state);
                log.system(`\n🏁 Converged after ${iteration} iteration(s): ${ruleResult.feedback}`);
                return { iterations: iteration, converged: true, reason: ruleResult.feedback };
            }

            // Agentic terminator for nuanced cases (CONTINUE from rules = defer to agent)
            const termResult = await withRetry(
                (cfg) => runTerminator(client, cfg, {
                    evalResult: evalResult,
                    history: state.history,
                }),
                agents.terminator,
                agents.terminator.retryBudget ?? maxRetries,
            );

            if (termResult.result === "SUCCESS" || termResult.result === "FAILURE") {
                state.phase = "done";
                saveState(state);
                log.system(
                    `\n🏁 ${termResult.result} after ${iteration} iteration(s): ${termResult.feedback}`,
                );
                return { iterations: iteration, converged: termResult.result === "SUCCESS", reason: termResult.feedback };
            }

            log.system(`🔄 Continuing: ${termResult.feedback}`);
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

async function withRetry<T>(fn: (config: AgentConfig) => Promise<T>, config: AgentConfig, retries: number): Promise<T> {
    let currentModel = config.model;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn({ ...config, model: currentModel });
        } catch (err) {
            if (attempt === retries) throw err;
            const friendly = formatError(err as Error);
            log.system(`⚠️ Attempt ${attempt + 1} failed: ${friendly}`);

            // On rate-limit errors, try falling back to the next model
            if (isRateLimitError(err as Error)) {
                const next = getNextModel(currentModel);
                if (next) {
                    log.system(`   🔄 Falling back: ${currentModel} → ${next}`);
                    currentModel = next;
                } else {
                    log.system(`   No more fallback models available.`);
                }
            }

            log.system(`   Waiting ${RETRY_BACKOFF_MS / 1000}s before retry...`);
            await sleep(RETRY_BACKOFF_MS);
        }
    }
    throw new Error("Unreachable");
}
