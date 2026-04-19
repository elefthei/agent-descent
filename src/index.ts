/**
 * agent-descent — library API.
 * For CLI entry point, see cli.ts.
 */

export { setup, descent, recover } from "./descent.js";
export { DEFAULT_MODEL, MODEL_CHAIN, getNextModel } from "./models.js";
export type {
    AgentConfig,
    AgentConfigs,
    Agents,
    SetupOptions,
    DescentOptions,
    DescentResult,
    LoopContext,
} from "./descent.js";
export type { Agent, Implementor, Evaluator, Validator, EvaluatorResult, EvalOrchestratorResult, GatekeeperResult, ImplementorKind, ImplementorResult, EvalResults, GoalWeights } from "./types.js";
export { Gate, type Tri, type Rule } from "./rules.js";
export { weightedScore, weightedGaps, DEFAULT_GOAL_WEIGHTS } from "./types.js";
export { DescentError, CampaignError, IterationError } from "./errors.js";
export type { CampaignType } from "./errors.js";
export { llmAsJudge } from "./agents/llm-judge.js";

