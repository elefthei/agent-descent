import type { CopilotClient } from "@github/copilot-sdk";
import { type TerminatorDecision, type EvaluatorDecision } from "../tools/decisions.js";
import type { AgentConfig } from "../types.js";
import type { IterationRecord } from "../utils/state.js";
export interface TerminatorInput {
    evalDecision: EvaluatorDecision;
    history: IterationRecord[];
}
export declare function runTerminator(client: CopilotClient, ctx: AgentConfig, input?: TerminatorInput): Promise<TerminatorDecision>;
