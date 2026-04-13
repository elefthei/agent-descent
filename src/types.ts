import type { CopilotClient } from "@github/copilot-sdk";
import type { Rule } from "./rules.js";

// ── Agent Config ────────────────────────────────────────────

export interface AgentConfig {
    model: string;
    reasoningEffort?: "low" | "medium" | "high" | "xhigh";
    /** Timeout in ms for sendAndWait (default: 5 minutes) */
    timeout?: number;
    retryBudget?: number;
}

/** Default timeout for agent sessions: 1 hour */
export const DEFAULT_TIMEOUT = 60 * 60 * 1000;

// ── Agent Interface ─────────────────────────────────────────

/**
 * A single-session agent that runs and returns a typed result.
 * TContext is the input it needs, TResult is what it produces.
 */
export interface Agent<TContext, TResult> {
    name: string;
    run(client: CopilotClient, config: AgentConfig, ctx: TContext): Promise<TResult>;
}

// ── Implementor Interface ───────────────────────────────────

export type ImplementorKind = "Research" | "Plan" | "Feature" | "Reliability" | "Refactor";

/** Result from any implementor phase. */
export interface ImplementorResult {
    kinds: Set<ImplementorKind>;
    feedback: string;
    iterations: number;
}

/**
 * An agent that produces code changes, artifacts, or state mutations.
 */
export interface Implementor<TContext = void> extends Agent<TContext, ImplementorResult> {}

// ── Evaluator Interface ─────────────────────────────────────

/** Uniform result from any evaluator (axis, symbolic, or orchestrator). */
export interface EvaluatorResult {
    score: number;
    feedback: string;
}

/**
 * An agent that scores or assesses changes.
 */
export interface Evaluator<TContext = void> extends Agent<TContext, EvaluatorResult> {}

// ── Validator Interface ─────────────────────────────────────

import type { Tri } from "./rules.js";

/** Result of validator propositional logic evaluation. */
export interface GatekeeperResult {
    result: Tri;
    feedback: string;
}

/**
 * An agent that makes gate decisions using propositional logic (Gate rules).
 * The rule() method returns a composable Rule<TContext> for use with Gate combinators.
 */
export interface Validator<TContext> extends Agent<TContext, GatekeeperResult> {
    rule(): Rule<TContext>;
}

// ── Evaluator Orchestrator Result ───────────────────────────

/** Full result from the evaluator orchestrator — carries per-axis results + gate decision. */
export interface EvalOrchestratorResult extends EvaluatorResult {
    /** Per-axis evaluator results keyed by name (features, reliability, modularity, symbolic) */
    axes: Map<string, EvaluatorResult>;
    /** Gate decision: approve or reject */
    decision: "approve" | "reject";
}

// ── Shared Aliases ──────────────────────────────────────────

/** Map of axis name → evaluator result, used across evaluator and terminator modules. */
export type EvalResults = Map<string, EvaluatorResult>;
