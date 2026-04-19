import type { CopilotClient } from "@github/copilot-sdk";
import { writeFileSync } from "fs";
import {
    setupImplementor,
    researchImplementor,
    planImplementor,
    execImplementor,
    evaluatorOrchestrator,
    runSymbolicCheck,
    terminatorValidator,
    agenticTerminator,
    interventionValidator,
    radicalPlanImplementor,
    reliabilityCampaign,
    modularityCampaign,
    type InterventionResult,
} from "./agents/index.js";
import { recoveryResearcher } from "./agents/recovery.js";
import { gitCommitAll, gitRevertToBaseline, gitCommitDescendOnly, getHeadSha, getGitLog } from "./utils/git.js";
import { log } from "./utils/logger.js";
import { saveState, loadState, archiveIteration, consecutiveRejects, isValidState, loadGoalWeights, type DescentState, type IterationRecord, type InterventionRecord } from "./utils/state.js";
import { readFileOrDefault } from "./utils/files.js";
import { readFileSync } from "fs";
import { DEFAULT_MODEL } from "./models.js";
import { checkPreviousError } from "./utils/check-error.js";
import { withRetry } from "./utils/retry.js";
import { CampaignError, type CampaignType } from "./errors.js";
import { checkStagnation } from "./rules/stagnation.js";
import { reliabilityCampaignRule, modularityCampaignRule, radicalPlanRule, CAMPAIGN_WEIGHT_THRESHOLD, type EscalationContext } from "./rules/campaigns.js";
import type { AgentConfig, EvalOrchestratorResult, GatekeeperResult } from "./types.js";

// ── Public types ────────────────────────────────────────────

export type { AgentConfig } from "./types.js";

export interface AgentConfigs {
    implementor: AgentConfig;
    evaluator: AgentConfig;
    terminator: AgentConfig;
}

/** @deprecated Use AgentConfigs instead */
export type Agents = AgentConfigs;

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
    /** Number of iterations to observe for cascading failure detection (0 = disabled). Default: 3 */
    historyObserve?: number;
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
): Promise<AgentConfigs> {
    const agents: AgentConfigs = {
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
    const setupResult = await setupImplementor.run(client, config, { goalPath });

    // Store goal weights in state for downstream agents
    const initState = loadState();
    if (initState) {
        initState.goalWeights = setupResult.goalWeights;
        saveState(initState);
    }

    return agents;
}

// ── recover ─────────────────────────────────────────────────

/**
 * Run recovery analysis after a failed descent loop.
 * The recovery agent analyzes .descend/ artifacts and writes a recovery
 * plan to .descend/evaluator/report.md. Then resets state for a fresh run.
 */
export async function recover(
    client: CopilotClient,
    config: AgentConfig,
): Promise<void> {
    log.system("\n🔬 Recovery mode — analyzing failure...");
    await recoveryResearcher.run(client, config);

    // Reset state for fresh run, preserving the recovery plan in report.md
    const state = loadState();
    if (state) {
        state.iteration = 0;
        state.phase = "init";
        state.baselineCommit = getHeadSha();
        saveState(state);
        log.system(`🔄 State reset for recovery run (kept ${state.history.length} history records)`);
    }
}

// ── Phase helpers ───────────────────────────────────────────

interface LoopContext {
    client: CopilotClient;
    agents: AgentConfigs;
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

    const warning = await checkStagnation(ctx.state.history);
    if (warning) log.system(`⚠️ Stagnation warning: ${warning}`);

    return { evalResult, baseline };
}

/**
 * Run the symbolic evaluator after a campaign to verify it didn't break the build.
 * Returns true if the campaign is safe to keep, false if it was reverted.
 */
async function verifyCampaign(
    ctx: LoopContext,
    campaignName: CampaignType,
    baseline: string,
): Promise<boolean> {
    log.system(`   🔍 Verifying ${campaignName} campaign (symbolic check)...`);
    try {
        const result = await runSymbolicCheck(ctx.client, ctx.agents.evaluator, baseline);

        if (result.feedback.includes("FAIL:")) {
            log.system(`   ❌ ${campaignName} campaign broke the build — reverting`);
            log.system(`      Findings: ${result.feedback}`);
            gitRevertToBaseline(baseline);
            return false;
        }
        log.system(`   ✅ ${campaignName} campaign verified`);
        return true;
    } catch (err) {
        log.system(`   ⚠️ Verification failed for ${campaignName}: ${(err as Error).message} — keeping changes`);
        return true;
    }
}

// ── Escalation ──────────────────────────────────────────────

/** Run escalation campaigns. Returns true if any campaign executed. */
async function runEscalation(ctx: LoopContext, baseline: string): Promise<boolean> {
    const escCtx: EscalationContext = {
        history: ctx.state.history,
        maxReject: ctx.options.maxReject ?? 3,
    };
    const weights = loadGoalWeights();

    let runReliability = await reliabilityCampaignRule(escCtx) === "SUCCESS";
    let runModularity = await modularityCampaignRule(escCtx) === "SUCCESS";
    const runRadical = await radicalPlanRule(escCtx) === "SUCCESS";

    // Skip campaigns for axes with negligible goal weight
    if (runReliability && weights.reliability < CAMPAIGN_WEIGHT_THRESHOLD) {
        log.system(`   ⏭️ Skipping reliability campaign (weight ${(weights.reliability * 100).toFixed(0)}% < ${(CAMPAIGN_WEIGHT_THRESHOLD * 100).toFixed(0)}% threshold)`);
        runReliability = false;
    }
    if (runModularity && weights.modularity < CAMPAIGN_WEIGHT_THRESHOLD) {
        log.system(`   ⏭️ Skipping modularity campaign (weight ${(weights.modularity * 100).toFixed(0)}% < ${(CAMPAIGN_WEIGHT_THRESHOLD * 100).toFixed(0)}% threshold)`);
        runModularity = false;
    }

    if (!runReliability && !runModularity && !runRadical) return false;

    log.system("\n🚨 Escalation triggered...");
    let campaignsRan = false;

    if (runReliability) {
        log.system("   🛡️ Reliability campaign (scores declining or rejection streak)...");
        ctx.state.phase = "campaign:reliability";
        saveState(ctx.state);
        try {
            const r = await withRetry((cfg) => reliabilityCampaign.run(ctx.client, cfg), ctx.agents.implementor, ctx.maxRetries);
            log.system(`   ← [${[...r.kinds].join(", ")}] ${r.feedback}`);
            if (await verifyCampaign(ctx, "reliability", baseline)) {
                campaignsRan = true;
            }
        } catch (err) {
            throw new CampaignError("reliability", (err as Error).message);
        }
    }

    if (runModularity) {
        log.system("   🏗️ Modularity campaign (scores declining or rejection streak)...");
        ctx.state.phase = "campaign:modularity";
        saveState(ctx.state);
        try {
            const r = await withRetry((cfg) => modularityCampaign.run(ctx.client, cfg), ctx.agents.implementor, ctx.maxRetries);
            log.system(`   ← [${[...r.kinds].join(", ")}] ${r.feedback}`);
            if (await verifyCampaign(ctx, "modularity", baseline)) {
                campaignsRan = true;
            }
        } catch (err) {
            throw new CampaignError("modularity", (err as Error).message);
        }
    }

    if (runRadical && ctx.options.goalPath) {
        log.system("   🚨 Radical plan (rethink from goal.md)...");
        ctx.state.phase = "evaluator:radical";
        saveState(ctx.state);

        const rejectStreak = consecutiveRejects(ctx.state.history);
        const failureReports = ctx.state.history.slice(-rejectStreak).map((rec) => {
            const archived = readFileOrDefault(`.descend/history/iteration-${rec.iteration}/evaluator/report.md`, "");
            return archived || readFileOrDefault(".descend/evaluator/report.md", "");
        }).filter(Boolean);

        const goalContent = readFileSync(ctx.options.goalPath, "utf-8");
        try {
            await withRetry((cfg) => radicalPlanImplementor.run(ctx.client, cfg, { goalContent, failureReports }), ctx.agents.evaluator, ctx.maxRetries);
            log.system("   📋 RADICAL PLAN written");
            campaignsRan = true;
        } catch (err) {
            throw new CampaignError("radical-plan", (err as Error).message);
        }
    }

    return campaignsRan;
}

// ── Intervention ────────────────────────────────────────────

async function runInterventionCheck(
    ctx: LoopContext,
    baseline: string,
    window: number,
): Promise<InterventionResult | null> {
    log.system("🔍 Intervention check — scanning for cascading failures...");

    const gitLog = getGitLog(window * 3);
    const interventionCtx = {
        history: ctx.state.history,
        window,
        gitLog,
    };

    try {
        const result = await interventionValidator.run(ctx.client, ctx.agents.evaluator, interventionCtx);
        if (result.result === "SUCCESS" && result.revertTo) {
            return result;
        }
        log.system(`   Intervention: ${result.result} — ${result.feedback}`);
        return null;
    } catch (err) {
        log.system(`   ⚠️ Intervention check failed: ${(err as Error).message}`);
        return null;
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

async function handleIterationError(state: DescentState, baseline: string, iteration: number, message: string): Promise<string> {
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

    const warning = await checkStagnation(state.history);
    if (warning) log.system(`⚠️ Stagnation warning: ${warning}`);

    return newBaseline;
}

// ── descent ─────────────────────────────────────────────────

export async function descent(
    client: CopilotClient,
    agents: AgentConfigs,
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
            let evalPhase = await runEvaluatorPhase(ctx, baseline);
            baseline = evalPhase.baseline;

            // Intervention check — detect cascading failures before escalation
            const historyObserve = opts.historyObserve ?? 3;
            if (historyObserve > 0 && state.history.length >= historyObserve) {
                const intervention = await runInterventionCheck(ctx, baseline, historyObserve);
                if (intervention) {
                    // Intervention fired — revert, record, restart this iteration
                    log.system(`🚨 INTERVENTION: ${intervention.feedback}`);
                    log.system(`   Reverting to ${intervention.revertTo}`);
                    gitRevertToBaseline(intervention.revertTo!);
                    baseline = intervention.revertTo!;
                    state.baselineCommit = baseline;

                    if (!state.interventions) state.interventions = [];
                    state.interventions.push({
                        iteration,
                        revertedTo: intervention.revertTo!,
                        reason: intervention.feedback,
                        triggeredBy: "llm",
                    });

                    // Overwrite evaluator report so implementor knows context changed
                    writeFileSync(".descend/evaluator/report.md", [
                        "# Intervention — Reverted",
                        "",
                        `Reverted to commit ${intervention.revertTo}.`,
                        "",
                        `**Reason**: ${intervention.feedback}`,
                        "",
                        "The previous iterations showed a cascading failure pattern.",
                        "Start fresh from this baseline with a different strategy.",
                    ].join("\n"));

                    archiveIteration(iteration);
                    state.phase = "intervention";
                    saveState(state);
                    continue; // Restart this iteration from implementor
                }
            }

            let campaignsRan = false;
            try {
                campaignsRan = await runEscalation(ctx, baseline);
            } catch (err) {
                if (err instanceof CampaignError) {
                    log.system(`⚠️ ${err.message} — continuing to terminator`);
                } else {
                    throw err;
                }
            }

            // Re-evaluate after campaigns so the terminator sees updated scores
            if (campaignsRan) {
                log.system("🔍 Re-evaluating after campaigns...");
                evalPhase = await runEvaluatorPhase(ctx, baseline);
                baseline = evalPhase.baseline;
            }

            const result = await runTerminatorPhase(ctx, evalPhase.evalResult, iteration);
            if (result) return result;
        } catch (err) {
            baseline = await handleIterationError(state, baseline, iteration, (err as Error).message);
        }
    }

    state.phase = "done";
    saveState(state);
    log.system(`\n⚠️ Reached maximum iterations (${maxIterations}). Stopping.`);
    return { iterations: maxIterations, converged: false, reason: "max iterations reached" };
}
