import type { CopilotClient } from "@github/copilot-sdk";
import { type EvaluatorDecision } from "../tools/decisions.js";
import type { AgentConfig } from "../types.js";
export type { EvaluatorDecision } from "../tools/decisions.js";
export declare function runEvaluator(client: CopilotClient, ctx: AgentConfig, baselineSha?: string): Promise<EvaluatorDecision>;
export declare function runRadicalPlan(client: CopilotClient, ctx: AgentConfig, goalContent: string, failureReports: string[]): Promise<void>;
