import type { CopilotClient } from "@github/copilot-sdk";
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
/**
 * Initialize or resume the descent loop.
 * If .descend/ has valid state (state.json + 3 goal files), skip setup and resume.
 * Otherwise, run the setup agent to project goal.md into per-agent goal files.
 */
export declare function setup(client: CopilotClient, goalPath: string, options?: SetupOptions): Promise<Agents>;
/**
 * Run the agent descent loop: Implementor → Evaluator → Terminator → repeat.
 * Returns when the terminator says STOP or maxIterations is reached.
 */
export declare function descent(client: CopilotClient, agents: Agents, options?: DescentOptions): Promise<DescentResult>;
