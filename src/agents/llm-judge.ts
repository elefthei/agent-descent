import type { CopilotClient } from "@github/copilot-sdk";
import { approveAll, defineTool } from "@github/copilot-sdk";
import { z } from "zod";
import type { AgentConfig, Validator, GatekeeperResult } from "../types.js";
import { DEFAULT_TIMEOUT } from "../types.js";
import type { Rule, Tri } from "../rules.js";
import { attachLogger } from "../utils/logger.js";

// ── llmAsJudge Factory ──────────────────────────────────────

export interface LlmJudgeOptions<A> {
    name: string;
    prompt: string | ((ctx: A) => string);
    client: CopilotClient;
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
    function createDecisionTool() {
        const box = { result: null as GatekeeperResult | null };

        const tool = defineTool("make_decision", {
            description: "Submit your decision: SUCCESS, FAILURE, or CONTINUE.",
            parameters: z.object({
                result: z
                    .enum(["SUCCESS", "FAILURE", "CONTINUE"])
                    .describe("SUCCESS=positive, FAILURE=negative, CONTINUE=defer"),
                feedback: z
                    .string()
                    .describe("Brief explanation of your decision"),
            }),
            skipPermission: true,
            handler: async (params: { result: Tri; feedback: string }) => {
                box.result = params;
                return `Decision recorded: ${params.result}`;
            },
        });

        return { tool, getResult: () => box.result };
    }

    async function evaluate(client: CopilotClient, config: AgentConfig, ctx: A): Promise<GatekeeperResult> {
        const { tool, getResult } = createDecisionTool();
        const promptText = typeof options.prompt === "function"
            ? options.prompt(ctx)
            : options.prompt;

        const session = await client.createSession({
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
        });
        attachLogger(session, options.name);

        await session.sendAndWait({
            prompt: [
                promptText,
                "",
                "Call the make_decision tool with your verdict: SUCCESS, FAILURE, or CONTINUE.",
            ].join("\n"),
        }, config.timeout ?? DEFAULT_TIMEOUT);

        await session.disconnect();
        await client.deleteSession(session.sessionId);

        const result = getResult();
        if (!result) {
            throw new Error(`${options.name} did not call make_decision tool`);
        }
        return result;
    }

    return {
        name: options.name,

        rule(): Rule<A> {
            return async (ctx: A) => {
                const config: AgentConfig = {
                    model: options.model ?? "claude-sonnet-4.6",
                    reasoningEffort: options.reasoningEffort ?? "high",
                };
                const result = await evaluate(options.client, config, ctx);
                return result.result;
            };
        },

        async run(client: CopilotClient, config: AgentConfig, ctx: A): Promise<GatekeeperResult> {
            return evaluate(client, config, ctx);
        },
    };
}
