import { approveAll, defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import { existsSync, readFileSync } from "fs";
import { attachLogger } from "../utils/logger.js";
/**
 * Agentic check: spins up a lightweight agent session to read a file
 * and determine if the predecessor agent failed due to a system error.
 * Returns true if the file indicates a system/API error (not a code quality issue).
 */
export async function checkPreviousError(client, config, filePath) {
    if (!existsSync(filePath))
        return false;
    const content = readFileSync(filePath, "utf-8");
    // Quick heuristic — skip the agent call for obvious cases
    if (!content || content.trim().length === 0)
        return false;
    if (content.includes("# Initial State"))
        return false;
    // Only spin up an agent if the content looks suspicious
    const errorSignals = [
        "failed:",
        "Error Report",
        "Failed to get response",
        "rate limit",
        "Timeout",
        "API error",
        "retried",
    ];
    if (!errorSignals.some((s) => content.includes(s)))
        return false;
    // Agentic check for ambiguous cases
    const box = { result: null };
    const tool = defineTool("report_error_check", {
        description: "Report whether the file contains a system/API error or legitimate evaluation content.",
        parameters: z.object({
            hasError: z.boolean().describe("true if this is a system/API error, false if it's a legitimate report"),
            reason: z.string().describe("Brief explanation"),
        }),
        skipPermission: true,
        handler: async (params) => {
            box.result = params;
            return `Checked: hasError=${params.hasError}`;
        },
    });
    const session = await client.createSession({
        workingDirectory: process.cwd(),
        model: config.model,
        reasoningEffort: "low",
        systemMessage: {
            mode: "replace",
            content: "Determine if this file contains a SYSTEM ERROR (API failure, timeout, rate limit) or LEGITIMATE CONTENT (code review, evaluation, plan). Call report_error_check with your verdict. Be brief.",
        },
        tools: [tool],
        onPermissionRequest: approveAll,
        infiniteSessions: { enabled: false },
        streaming: true,
    });
    attachLogger(session, "system");
    await session.sendAndWait({
        prompt: `Is this a system error or legitimate content?\n\n---\n${content.slice(0, 2000)}\n---`,
    }, 30_000);
    await session.disconnect();
    await client.deleteSession(session.sessionId);
    return box.result?.hasError ?? false;
}
//# sourceMappingURL=check-error.js.map