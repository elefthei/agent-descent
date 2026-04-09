import type { CopilotClient } from "@github/copilot-sdk";
import type { AgentConfig } from "../types.js";
export declare function runImplementorResearch(client: CopilotClient, ctx: AgentConfig): Promise<void>;
export declare function runImplementorPlan(client: CopilotClient, ctx: AgentConfig): Promise<void>;
export declare function runImplementorExec(client: CopilotClient, ctx: AgentConfig): Promise<void>;
