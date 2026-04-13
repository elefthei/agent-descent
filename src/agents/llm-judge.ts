import type { CopilotClient } from "@github/copilot-sdk";
import { approveAll } from "@github/copilot-sdk";
import type { AgentConfig, Validator, GatekeeperResult } from "../types.js";
import { DEFAULT_TIMEOUT } from "../types.js";
import { Gate, type Rule } from "../rules.js";
import { attachLogger } from "../utils/logger.js";
import { withSession } from "../utils/session.js";
import { createGatekeeperTool } from "../tools/decisions.js";

// ── llmAsJudge Factory ──────────────────────────────────────

export interface LlmJudgeOptions<A> {
    name: string;
    prompt: string | ((ctx: A) => string);
    model?: string;
    reasoningEffort?: AgentConfig["reasoningEffort"];
    systemMessage?: string;
}

/**
 * Create a Validator<A> backed by an LLM.
 * The returned validator's rule() produces a Rule<A> that calls the LLM
 * and extracts a Tri decision via a tool call.
 *
 * Usage:
 *   const judge = llmAsJudge<MyContext>({
 *       name: "my-judge",
 *       prompt: (ctx) => `Evaluate: ${JSON.stringify(ctx)}`,
 *       client,
 *   });
 *   const result = await judge.rule()(myContext);  // Tri
 *   const full = await judge.run(client, config, myContext);  // GatekeeperResult
 */
export function llmAsJudge<A>(options: LlmJudgeOptions<A>): Validator<A> {
    async function evaluate(client: CopilotClient, config: AgentConfig, ctx: A): Promise<GatekeeperResult> {
        const { tool, getResult } = createGatekeeperTool();
        const promptText = typeof options.prompt === "function"
            ? options.prompt(ctx)
            : options.prompt;

        return withSession(client, {
            workingDirectory: process.cwd(),
            model: config.model ?? options.model ?? "claude-sonnet-4.6",
            reasoningEffort: config.reasoningEffort ?? options.reasoningEffort ?? "high",
            systemMessage: options.systemMessage
                ? { mode: "replace", content: options.systemMessage }
                : undefined,
            tools: [tool],
            onPermissionRequest: approveAll,
            infiniteSessions: { enabled: false },
            streaming: true,
        }, async (session) => {
            attachLogger(session, options.name);
            await session.sendAndWait({
                prompt: [
                    promptText, "",
                    "Call the make_decision tool with your verdict: SUCCESS, FAILURE, or CONTINUE.",
                ].join("\n"),
            }, config.timeout ?? DEFAULT_TIMEOUT);

            const result = getResult();
            if (!result) throw new Error(`${options.name} did not call make_decision tool`);
            return result;
        });
    }

    return {
        name: options.name,

        rule(): Rule<A> {
            // LLM-backed rules require a session — use run() for actual evaluation.
            // rule() returns CONTINUE (defer) so it can be composed in Gate expressions
            // without requiring a client at composition time.
            return Gate.defer<A>();
        },

        async run(client: CopilotClient, config: AgentConfig, ctx: A): Promise<GatekeeperResult> {
            return evaluate(client, config, ctx);
        },
    };
}
