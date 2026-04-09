import type { CopilotClient } from "@github/copilot-sdk";
import type { AgentConfig } from "../types.js";
export declare function runSetup(client: CopilotClient, config: AgentConfig, goalPath: string): Promise<void>;
