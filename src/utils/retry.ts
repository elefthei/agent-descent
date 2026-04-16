import type { AgentConfig } from "../types.js";
import { getNextModel, isRateLimitError } from "../models.js";
import { log } from "./logger.js";

export const RETRY_BACKOFF_MS = 30_000;

export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatError(err: Error): string {
    const msg = err.message;
    if (msg.includes("Timeout") && msg.includes("waiting for session.idle")) {
        return "⏱️ Agent session timed out. Try --timeout M for longer sessions.";
    }
    if (msg.includes("Failed to get response from the AI model")) {
        return "🌐 AI model API error (rate limit or outage). Will retry after backoff.";
    }
    return msg;
}

export async function withRetry<T>(fn: (config: AgentConfig) => Promise<T>, config: AgentConfig, retries: number): Promise<T> {
    let currentModel = config.model;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn({ ...config, model: currentModel });
        } catch (err) {
            if (attempt === retries) throw err;
            const friendly = formatError(err as Error);
            log.system(`⚠️ Attempt ${attempt + 1} failed: ${friendly}`);

            if (isRateLimitError(err as Error)) {
                const next = getNextModel(currentModel);
                if (next) {
                    log.system(`   🔄 Falling back: ${currentModel} → ${next}`);
                    currentModel = next;
                } else {
                    log.system(`   No more fallback models available.`);
                }
            }

            log.system(`   Waiting ${RETRY_BACKOFF_MS / 1000}s before retry...`);
            await sleep(RETRY_BACKOFF_MS);
        }
    }
    throw new Error("Unreachable");
}
