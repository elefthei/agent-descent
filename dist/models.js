/**
 * Model fallback chain — ordered by capability (best first).
 * On rate-limit or API error, fall back to the next model.
 */
export const MODEL_CHAIN = [
    { id: "claude-opus-4.6-1m", rpmLimit: 6 },
    { id: "claude-opus-4.6", rpmLimit: 3 },
    { id: "gpt-5.4", rpmLimit: 1 },
    { id: "gpt-5.3-codex", rpmLimit: 1 },
    { id: "claude-sonnet-4.6", rpmLimit: 1 },
];
export const SUPPORTED_MODELS = new Set(MODEL_CHAIN.map((m) => m.id));
export const DEFAULT_MODEL = MODEL_CHAIN[0].id;
/**
 * Get the next model in the fallback chain.
 * Returns null if already at the last model.
 */
export function getNextModel(currentModel) {
    const idx = MODEL_CHAIN.findIndex((m) => m.id === currentModel);
    if (idx === -1 || idx >= MODEL_CHAIN.length - 1)
        return null;
    return MODEL_CHAIN[idx + 1].id;
}
/**
 * Check if an error is a rate-limit or API availability error.
 */
export function isRateLimitError(err) {
    const msg = err.message;
    return (msg.includes("Failed to get response from the AI model") ||
        msg.includes("rate limit") ||
        msg.includes("Rate limit") ||
        msg.includes("429") ||
        msg.includes("503") ||
        msg.includes("overloaded"));
}
//# sourceMappingURL=models.js.map