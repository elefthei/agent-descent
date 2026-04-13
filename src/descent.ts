import type { CopilotClient } from "@github/copilot-sdk";
import { writeFileSync } from "fs";
import { setupImplementor } from "./agents/setup.js";
import {
    researchImplementor,
    planImplementor,
    execImplementor,
} from "./agents/implementor.js";
import { evaluatorOrchestrator, radicalPlanImplementor } from "./agents/evaluator.js";
import { terminatorValidator, agenticTerminator } from "./agents/terminator.js";
import { reliabilityCampaign } from "./agents/campaigns/reliability.js";
import { modularityCampaign } from "./agents/campaigns/modularity.js";
import { gitCommitAll, gitRevertToBaseline, gitCommitDescendOnly, getHeadSha } from "./utils/git.js";
import { log } from "./utils/logger.js";
import { saveState, loadState, archiveIteration, detectStagnation, consecutiveRejects, isValidState, type DescentState, type IterationRecord } from "./utils/state.js";
import { readFileOrDefault } from "./utils/files.js";
import { readFileSync } from "fs";
import { DEFAULT_MODEL, getNextModel, isRateLimitError } from "./models.js";
import { checkPreviousError } from "./utils/check-error.js";
import type { AgentConfig, EvalOrchestratorResult } from "./types.js";

// ── Public types ────────────────────────────────────────────

export type { AgentConfig } from "./types.js";

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
        log.system(`♻️  Resuming — .descend/ has valid state (${state?.history.length ?? 0} previous iteration(s))`);
        return agents;
    }

    const config: AgentConfig = {
        model: options?.implementorModel ?? DEFAULT_MODEL,
        reasoningEffort: "high",
        timeout: options?.timeout,
    };
    await setupImplementor.run(client, config, { goalPath });
    return agents;
}

// ── Phase helpers ───────────────────────────────────────────

interface LoopContext {
    client: CopilotClient;
    agents: Agents;
    state: DescentState;
    options: DescentOptions;
    maxRetries: number;
}

function resumeOrInitState(): { state: DescentState; startIteration: number; baseline: string } {
    const existingState = loadState();

    if (!existingState) {
        const baseline = getHeadSha();
        return {
            state: { iteration: 0, baselineCommit: baseline, phase: "init", history: [] },
            startIteration: 1,
            baseline,
        };
    }

    const baseline = existingState.baselineCommit;

    if (existingState.phase === "done" || existingState.phase === "init") {
        // iteration=0 means fresh reset — start from 1 regardless of history size
        const start = existingState.iteration === 0 ? 1 : existingState.history.length + 1;
        return { state: existingState, startIteration: start, baseline };
    }

    // Interrupted mid-iteration — revert and redo
    log.system(`⚠️ Previous run interrupted during phase: ${existingState.phase}`);
    log.system(`   Reverting to baseline and restarting iteration ${existingState.iteration}`);
    gitRevertToBaseline(baseline);

    if (existingState.history.length > 0 &&
        existingState.history[existingState.history.length - 1]!.iteration === existingState.iteration) {
        existingState.history.pop();
    }

    return {
        state: existingState,
        startIteration: existingState.iteration > 0 ? existingState.iteration : 1,
        baseline,
    };
}

async function runImplementorPhase(ctx: LoopContext): Promise<void> {
    const implRetries = ctx.agents.implementor.retryBudget ?? ctx.maxRetries;

    // Check predecessor error
    if (await checkPreviousError(ctx.client, ctx.agents.evaluator, ".descend/evaluator/report.md")) {
        log.system("⚠️ Evaluator report contains system error — re-running evaluator");
        await withRetry((cfg) => evaluatorOrchestrator.run(ctx.client, cfg, { baselineSha: ctx.state.baselineCommit }), ctx.agents.evaluator, ctx.maxRetries);
    }

    if (!ctx.options.skipResearch) {
        log.system("📚 Implementor: Research phase...");
        ctx.state.phase = "implementor:research";
        saveState(ctx.state);
        const r = await withRetry((cfg) => researchImplementor.run(ctx.client, cfg), ctx.agents.implementor, implRetries);
        log.system(`   ← research: [${[...r.kinds].join(", ")}] ${r.feedback}`);
    }

    if (!ctx.options.skipPlan) {
        log.system("📋 Implementor: Plan phase...");
        ctx.state.phase = "implementor:plan";
        saveState(ctx.state);
        const r = await withRetry((cfg) => planImplementor.run(ctx.client, cfg), ctx.agents.implementor, implRetries);
        log.system(`   ← plan: [${[...r.kinds].join(", ")}] ${r.feedback}`);
    }

    log.system("🔧 Implementor: Execute phase...");
    ctx.state.phase = "implementor:exec";
    saveState(ctx.state);

    // Check predecessor error
    if (await checkPreviousError(ctx.client, ctx.agents.implementor, ".descend/implementor/report.md")) {
        log.system("⚠️ Implementor report contains system error — re-running implementor:exec");
        await withRetry((cfg) => execImplementor.run(ctx.client, cfg), ctx.agents.implementor, implRetries);
    }

    const r = await withRetry((cfg) => execImplementor.run(ctx.client, cfg), ctx.agents.implementor, implRetries);
    log.system(`   ← exec: [${[...r.kinds].join(", ")}] ${r.feedback}`);
}

async function runEvaluatorPhase(
    ctx: LoopContext,
    baseline: string,
): Promise<{ evalResult: EvalOrchestratorResult; baseline: string }> {
    ctx.state.phase = "evaluator";
    saveState(ctx.state);

    log.system("🔍 Evaluator: Reviewing changes...");
    const evalResult = await withRetry(
        (cfg) => evaluatorOrchestrator.run(ctx.client, cfg, { baselineSha: baseline }),
        ctx.agents.evaluator,
        ctx.agents.evaluator.retryBudget ?? ctx.maxRetries,
    );

    const scoreStr = [...evalResult.axes.entries()]
        .filter(([n]) => n !== "symbolic")
        .map(([n, r]) => `${n}=${r.score}`)
        .join(", ");

    if (evalResult.decision === "approve") {
        log.system(`✅ Evaluator APPROVED (score=${evalResult.score})`);
        log.system(`   ${scoreStr}`);
        gitCommitAll(ctx.state.iteration, evalResult.feedback);
        baseline = getHeadSha();
    } else {
        log.system(`❌ Evaluator REJECTED (score=${evalResult.score})`);
        log.system(`   ${scoreStr}`);
        gitRevertToBaseline(baseline);
        gitCommitDescendOnly(ctx.state.iteration, evalResult.feedback);
        baseline = getHeadSha();
    }

    ctx.state.baselineCommit = baseline;
    ctx.state.history.push({
        iteration: ctx.state.iteration,
        decision: evalResult.decision,
        scores: {
            features: evalResult.axes.get("features")?.score ?? 0,
            reliability: evalResult.axes.get("reliability")?.score ?? 0,
            modularity: evalResult.axes.get("modularity")?.score ?? 0,
        },
        summary: evalResult.feedback,
    });
    saveState(ctx.state);

    const warning = detectStagnation(ctx.state.history);
    if (warning) log.system(`⚠️ Stagnation warning: ${warning}`);

    return { evalResult, baseline };
}

async function runEscalation(ctx: LoopContext): Promise<void> {
    const rejectStreak = consecutiveRejects(ctx.state.history);
    if (rejectStreak < (ctx.options.maxReject ?? 3)) return;

    log.system(`\n🚨 ${rejectStreak} consecutive rejections — escalating...`);

    // Step 1: Reliability campaign
    log.system("   Step 1/3: 🛡️ Reliability campaign...");
    ctx.state.phase = "campaign:reliability";
    saveState(ctx.state);
    const relResult = await withRetry((cfg) => reliabilityCampaign.run(ctx.client, cfg), ctx.agents.implementor, ctx.maxRetries);
    log.system(`   ← [${[...relResult.kinds].join(", ")}] ${relResult.feedback}`);

    // Step 2: Modularity campaign
    log.system("   Step 2/3: 🏗️ Modularity campaign...");
    ctx.state.phase = "campaign:modularity";
    saveState(ctx.state);
    const modResult = await withRetry((cfg) => modularityCampaign.run(ctx.client, cfg), ctx.agents.implementor, ctx.maxRetries);
    log.system(`   ← [${[...modResult.kinds].join(", ")}] ${modResult.feedback}`);

    // Step 3: Radical plan
    if (ctx.options.goalPath) {
        log.system("   Step 3/3: 🚨 Radical plan...");
        ctx.state.phase = "evaluator:radical";
        saveState(ctx.state);

        const failureReports = ctx.state.history.slice(-rejectStreak).map((rec) => {
            const archived = readFileOrDefault(`.descend/history/iteration-${rec.iteration}/evaluator/report.md`, "");
            return archived || readFileOrDefault(".descend/evaluator/report.md", "");
        }).filter(Boolean);

        const goalContent = readFileSync(ctx.options.goalPath, "utf-8");
        await withRetry((cfg) => radicalPlanImplementor.run(ctx.client, cfg, { goalContent, failureReports }), ctx.agents.evaluator, ctx.maxRetries);
        log.system("   📋 RADICAL PLAN written");
    }
}

async function runTerminatorPhase(
    ctx: LoopContext,
    evalResult: EvalOrchestratorResult,
    iteration: number,
): Promise<DescentResult | null> {
    ctx.state.phase = "terminator";
    saveState(ctx.state);

    // Check predecessor error
    if (await checkPreviousError(ctx.client, ctx.agents.evaluator, ".descend/evaluator/report.md")) {
        log.system("⚠️ Evaluator report contains system error — re-running evaluator");
        const retryEval = await withRetry(
            (cfg) => evaluatorOrchestrator.run(ctx.client, cfg, { baselineSha: ctx.state.baselineCommit }),
            ctx.agents.evaluator, ctx.maxRetries,
        );
        Object.assign(evalResult, retryEval);
    }

    log.system("🎯 Terminator: Checking convergence...");

    // Rule-based pre-check (fast, deterministic)
    const ruleResult = await terminatorValidator.run(ctx.client, ctx.agents.terminator, { results: evalResult.axes, history: ctx.state.history, iteration });
    log.system(`   Rule check: ${ruleResult.result} — ${ruleResult.feedback}`);

    if (ruleResult.result === "SUCCESS") {
        ctx.state.phase = "done";
        saveState(ctx.state);
        log.system(`\n🏁 Converged after ${iteration} iteration(s): ${ruleResult.feedback}`);
        return { iterations: iteration, converged: true, reason: ruleResult.feedback };
    }

    // Agentic terminator for nuanced cases
    const termResult = await withRetry(
        (cfg) => agenticTerminator.run(ctx.client, cfg, { evalResult, history: ctx.state.history }),
        ctx.agents.terminator,
        ctx.agents.terminator.retryBudget ?? ctx.maxRetries,
    );

    if (termResult.result === "SUCCESS" || termResult.result === "FAILURE") {
        ctx.state.phase = "done";
        saveState(ctx.state);
        log.system(`\n🏁 ${termResult.result} after ${iteration} iteration(s): ${termResult.feedback}`);
        return { iterations: iteration, converged: termResult.result === "SUCCESS", reason: termResult.feedback };
    }

    log.system(`🔄 Continuing: ${termResult.feedback}`);
    return null;
}

function handleIterationError(state: DescentState, baseline: string, iteration: number, message: string): string {
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

    const newBaseline = getHeadSha();
    state.baselineCommit = newBaseline;
    state.history.push({ iteration, decision: "error", summary: message });
    saveState(state);

    const warning = detectStagnation(state.history);
    if (warning) log.system(`⚠️ Stagnation warning: ${warning}`);

    return newBaseline;
}

// ── descent ─────────────────────────────────────────────────

export async function descent(
    client: CopilotClient,
    agents: Agents,
    options?: DescentOptions,
): Promise<DescentResult> {
    const maxRetries = options?.maxRetries ?? 2;
    const maxIterations = options?.maxIterations ?? 10;
    const opts = options ?? {};

    const { state, startIteration, baseline: initialBaseline } = resumeOrInitState();
    let baseline = initialBaseline;
    saveState(state);

    if (startIteration > 1) {
        log.system(`♻️  Continuing from iteration ${startIteration} (${state.history.length} previous)`);
    }

    const ctx: LoopContext = { client, agents, state, options: opts, maxRetries };

    for (let iteration = startIteration; iteration <= maxIterations; iteration++) {
        log.system(`\n${"═".repeat(60)}`);
        log.system(`  Iteration ${iteration} / ${maxIterations}`);
        log.system(`${"═".repeat(60)}\n`);

        if (iteration > 1) archiveIteration(iteration - 1);

        state.iteration = iteration;
        state.phase = "implementor:research";
        saveState(state);

        try {
            await runImplementorPhase(ctx);
            const evalPhase = await runEvaluatorPhase(ctx, baseline);
            baseline = evalPhase.baseline;

            await runEscalation(ctx);

            const result = await runTerminatorPhase(ctx, evalPhase.evalResult, iteration);
            if (result) return result;
        } catch (err) {
            baseline = handleIterationError(state, baseline, iteration, (err as Error).message);
        }
    }

    state.phase = "done";
    saveState(state);
    log.system(`\n⚠️ Reached maximum iterations (${maxIterations}). Stopping.`);
    return { iterations: maxIterations, converged: false, reason: "max iterations reached" };
}

// ── internal ────────────────────────────────────────────────

const RETRY_BACKOFF_MS = 30_000;

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
