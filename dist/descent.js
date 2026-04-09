import { writeFileSync } from "fs";
import { runSetup } from "./agents/setup.js";
import { runImplementorResearch, runImplementorPlan, runImplementorExec, } from "./agents/implementor.js";
import { runEvaluator, runRadicalPlan } from "./agents/evaluator.js";
import { runTerminator } from "./agents/terminator.js";
import { gitCommitAll, gitRevertToBaseline, gitCommitDescendOnly, getHeadSha } from "./utils/git.js";
import { log } from "./utils/logger.js";
import { saveState, loadState, archiveIteration, detectStagnation, consecutiveRejects, isValidState } from "./utils/state.js";
import { readFileOrDefault } from "./utils/files.js";
import { readFileSync } from "fs";
import { DEFAULT_MODEL, getNextModel, isRateLimitError } from "./models.js";
import { checkPreviousError } from "./utils/check-error.js";
// ── setup ───────────────────────────────────────────────────
/**
 * Initialize or resume the descent loop.
 * If .descend/ has valid state (state.json + 3 goal files), skip setup and resume.
 * Otherwise, run the setup agent to project goal.md into per-agent goal files.
 */
export async function setup(client, goalPath, options) {
    const agents = {
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
    const config = {
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
export async function descent(client, agents, options) {
    const maxIterations = options?.maxIterations ?? 10;
    const maxRetries = options?.maxRetries ?? 2;
    const maxReject = options?.maxReject ?? 3;
    // Resume from existing state or start fresh
    const existingState = loadState();
    let startIteration;
    let baseline;
    if (existingState) {
        baseline = existingState.baselineCommit;
        const lastPhase = existingState.phase;
        if (lastPhase === "done" || lastPhase === "init") {
            // Clean boundary — start next iteration
            startIteration = existingState.history.length + 1;
        }
        else {
            // Interrupted mid-iteration — revert and redo this iteration
            log.system(`⚠️ Previous run interrupted during phase: ${lastPhase}`);
            log.system(`   Reverting to baseline and restarting iteration ${existingState.iteration}`);
            gitRevertToBaseline(baseline);
            // Remove partial iteration record if it was added
            if (existingState.history.length > 0 &&
                existingState.history[existingState.history.length - 1].iteration === existingState.iteration) {
                existingState.history.pop();
            }
            startIteration = existingState.iteration > 0 ? existingState.iteration : 1;
        }
    }
    else {
        baseline = getHeadSha();
        startIteration = 1;
    }
    const state = existingState ?? {
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
                await withRetry((cfg) => runEvaluator(client, cfg, baseline), agents.evaluator, agents.evaluator.retryBudget ?? maxRetries);
            }
            if (!options?.skipResearch) {
                log.system("📚 Implementor: Research phase...");
                await withRetry((cfg) => runImplementorResearch(client, cfg), agents.implementor, implRetries);
                state.phase = "implementor:plan";
                saveState(state);
            }
            if (!options?.skipPlan) {
                log.system("📋 Implementor: Plan phase...");
                await withRetry((cfg) => runImplementorPlan(client, cfg), agents.implementor, implRetries);
                state.phase = "implementor:exec";
                saveState(state);
            }
            log.system("🔧 Implementor: Execute phase...");
            await withRetry((cfg) => runImplementorExec(client, cfg), agents.implementor, implRetries);
            // Evaluator: Review + decide (diff against baseline for owned changes only)
            state.phase = "evaluator";
            saveState(state);
            // Check if implementor's report has a system error
            if (await checkPreviousError(client, agents.implementor, ".descend/implementor/report.md")) {
                log.system("⚠️ Implementor report contains system error — re-running implementor:exec");
                await withRetry((cfg) => runImplementorExec(client, cfg), agents.implementor, implRetries);
            }
            log.system("🔍 Evaluator: Reviewing changes...");
            const evalResult = await withRetry((cfg) => runEvaluator(client, cfg, baseline), agents.evaluator, agents.evaluator.retryBudget ?? maxRetries);
            const record = {
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
            }
            else {
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
                const failureReports = [];
                const recentRejects = state.history.slice(-rejectStreak);
                for (const rec of recentRejects) {
                    const archived = readFileOrDefault(`.descend/history/iteration-${rec.iteration}/evaluator/report.md`, "");
                    // Fall back to current report for the most recent iteration
                    const report = archived || readFileOrDefault(".descend/evaluator/report.md", "");
                    if (report)
                        failureReports.push(report);
                }
                const goalContent = readFileSync(options.goalPath, "utf-8");
                await withRetry((cfg) => runRadicalPlan(client, cfg, goalContent, failureReports), agents.evaluator, agents.evaluator.retryBudget ?? maxRetries);
                log.system("📋 RADICAL PLAN written to .descend/evaluator/report.md");
            }
            // Terminator: Continue or stop?
            state.phase = "terminator";
            saveState(state);
            // Check if evaluator's report has a system error
            if (await checkPreviousError(client, agents.evaluator, ".descend/evaluator/report.md")) {
                log.system("⚠️ Evaluator report contains system error — re-running evaluator");
                const retryEval = await withRetry((cfg) => runEvaluator(client, cfg, baseline), agents.evaluator, agents.evaluator.retryBudget ?? maxRetries);
                // Update evalResult for the terminator
                Object.assign(evalResult, retryEval);
            }
            log.system("🎯 Terminator: Checking convergence...");
            const termResult = await withRetry((cfg) => runTerminator(client, cfg, {
                evalDecision: evalResult,
                history: state.history,
            }), agents.terminator, agents.terminator.retryBudget ?? maxRetries);
            if (termResult.decision === "stop") {
                state.phase = "done";
                saveState(state);
                log.system(`\n🏁 Converged after ${iteration} iteration(s): ${termResult.reason}`);
                return { iterations: iteration, converged: true, reason: termResult.reason };
            }
            log.system(`🔄 Continuing: ${termResult.reason}`);
        }
        catch (err) {
            const message = err.message;
            log.system(`⚠️ Iteration ${iteration} failed after retries: ${message}`);
            gitRevertToBaseline(baseline);
            writeFileSync(".descend/evaluator/report.md", [
                "# Error Report",
                "",
                `Iteration ${iteration} failed: ${message}`,
                "",
                "The implementor should retry the previous approach or try a different strategy.",
            ].join("\n"));
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
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function formatError(err) {
    const msg = err.message;
    if (msg.includes("Timeout") && msg.includes("waiting for session.idle")) {
        return "⏱️ Agent session timed out. Try --timeout M for longer sessions.";
    }
    if (msg.includes("Failed to get response from the AI model")) {
        return "🌐 AI model API error (rate limit or outage). Will retry after backoff.";
    }
    return msg;
}
async function withRetry(fn, config, retries) {
    let currentModel = config.model;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn({ ...config, model: currentModel });
        }
        catch (err) {
            if (attempt === retries)
                throw err;
            const friendly = formatError(err);
            log.system(`⚠️ Attempt ${attempt + 1} failed: ${friendly}`);
            // On rate-limit errors, try falling back to the next model
            if (isRateLimitError(err)) {
                const next = getNextModel(currentModel);
                if (next) {
                    log.system(`   🔄 Falling back: ${currentModel} → ${next}`);
                    currentModel = next;
                }
                else {
                    log.system(`   No more fallback models available.`);
                }
            }
            log.system(`   Waiting ${RETRY_BACKOFF_MS / 1000}s before retry...`);
            await sleep(RETRY_BACKOFF_MS);
        }
    }
    throw new Error("Unreachable");
}
//# sourceMappingURL=descent.js.map