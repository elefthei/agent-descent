import type { CopilotClient } from "@github/copilot-sdk";
import type { AgentConfig } from "../types.js";
/**
 * Agentic check: spins up a lightweight agent session to read a file
 * and determine if the predecessor agent failed due to a system error.
 * Returns true if the file indicates a system/API error (not a code quality issue).
 */
export declare function checkPreviousError(client: CopilotClient, config: AgentConfig, filePath: string): Promise<boolean>;
