// Agent instances — re-exported for convenient imports

export { researchImplementor, planImplementor, execImplementor } from "./implementor.js";
export { evaluatorOrchestrator, approvalValidator } from "./evaluator.js";
export { terminatorValidator, agenticTerminator } from "./terminator.js";
export { radicalPlanImplementor } from "./radical-plan.js";
export { reliabilityCampaign } from "./campaigns/reliability.js";
export { modularityCampaign } from "./campaigns/modularity.js";
export { setupImplementor } from "./setup.js";
export { llmAsJudge } from "./llm-judge.js";

// Context types
export type { TerminatorContext, AgenticTerminatorInput } from "./terminator.js";
export type { RadicalPlanInput } from "./radical-plan.js";
export type { SetupInput } from "./setup.js";
