/**
 * Typed exceptions for the descent loop.
 * Allows the main loop to handle different failure modes appropriately.
 */

export class DescentError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DescentError";
    }
}

export type CampaignType = "reliability" | "modularity" | "radical-plan";

/**
 * A campaign failed — non-fatal for the iteration.
 * The main loop should log this and continue to the terminator phase.
 */
export class CampaignError extends DescentError {
    constructor(
        public readonly campaign: CampaignType,
        message: string,
    ) {
        super(`Campaign ${campaign} failed: ${message}`);
        this.name = "CampaignError";
    }
}

/**
 * An iteration-level failure (implementor, evaluator, or terminator).
 * The main loop should revert to baseline and move to the next iteration.
 */
export class IterationError extends DescentError {
    constructor(
        public readonly phase: string,
        message: string,
    ) {
        super(`Iteration failed in ${phase}: ${message}`);
        this.name = "IterationError";
    }
}
