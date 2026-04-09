/**
 * Model fallback chain — ordered by capability (best first).
 * On rate-limit or API error, fall back to the next model.
 */
interface ModelEntry {
    id: string;
    rpmLimit: number;
}
export declare const MODEL_CHAIN: ModelEntry[];
export declare const SUPPORTED_MODELS: Set<string>;
export declare const DEFAULT_MODEL: string;
/**
 * Get the next model in the fallback chain.
 * Returns null if already at the last model.
 */
export declare function getNextModel(currentModel: string): string | null;
/**
 * Check if an error is a rate-limit or API availability error.
 */
export declare function isRateLimitError(err: Error): boolean;
export {};
