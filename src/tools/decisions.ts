import { z } from "zod";
import { defineTool } from "@github/copilot-sdk";

export interface EvaluatorDecision {
    decision: "approve" | "reject";
    summary: string;
}

export interface TerminatorDecision {
    decision: "continue" | "stop";
    reason: string;
}

export function createEvaluatorDecisionTool() {
    let result: EvaluatorDecision | null = null;

    const tool = defineTool("submit_decision", {
        description:
            "Submit your final decision: approve or reject the implementor's changes",
        parameters: z.object({
            decision: z
                .enum(["approve", "reject"])
                .describe("Your verdict on the implementor's work"),
            summary: z
                .string()
                .describe("Brief summary explaining your decision"),
        }),
        skipPermission: true,
        handler: async ({
            decision,
            summary,
        }: {
            decision: "approve" | "reject";
            summary: string;
        }) => {
            result = { decision, summary };
            return `Decision recorded: ${decision}`;
        },
    });

    return { tool, getResult: () => result };
}

export function createTerminatorDecisionTool() {
    let result: TerminatorDecision | null = null;

    const tool = defineTool("make_decision", {
        description: "Decide whether the loop should continue or stop",
        parameters: z.object({
            decision: z
                .enum(["continue", "stop"])
                .describe("Whether to continue iterating or stop"),
            reason: z
                .string()
                .describe("Why you made this decision"),
        }),
        skipPermission: true,
        handler: async ({
            decision,
            reason,
        }: {
            decision: "continue" | "stop";
            reason: string;
        }) => {
            result = { decision, reason };
            return `Decision recorded: ${decision}`;
        },
    });

    return { tool, getResult: () => result };
}
