import type { CopilotClient } from "@github/copilot-sdk";

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

// ── Orchestrator Interface ──────────────────────────────────

/**
 * An orchestrator composes multiple agents and returns an aggregate result.
 * It is itself an Agent — orchestrators can be nested.
 */
export interface Orchestrator<TContext, TResult> extends Agent<TContext, TResult> {
    agents: Agent<any, any>[];
}

// ── Evaluator Interface ─────────────────────────────────────

/** Uniform result from any evaluator (axis, symbolic, or orchestrator). */
export interface EvaluatorResult {
    score: number;
    feedback: string;
}

// ── Gatekeeper Result ───────────────────────────────────────

import type { Tri } from "./rules.js";

/** Result of gatekeeper/terminator propositional logic evaluation. */
export interface GatekeeperResult {
    result: Tri;
    feedback: string;
}
