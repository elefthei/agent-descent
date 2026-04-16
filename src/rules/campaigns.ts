/**
 * Campaign gate rules — decide when to trigger escalation campaigns.
 * SUCCESS = trigger campaign, CONTINUE = skip, FAILURE = error.
 */

import { Gate, type Rule } from "../rules.js";
import type { IterationRecord } from "../utils/state.js";
import { consecutiveRejects, axisDeclining } from "../utils/state.js";

export interface EscalationContext {
    history: IterationRecord[];
    maxReject: number;
}

/** Minimum goal weight to justify running a campaign. */
export const CAMPAIGN_WEIGHT_THRESHOLD = 0.15;

export const consecutiveRejectsAbove = (n: number): Rule<EscalationContext> =>
    Gate.lift((ctx) => Gate.fromBool(consecutiveRejects(ctx.history) >= n));

export const reliabilityDeclining: Rule<EscalationContext> = Gate.lift((ctx) =>
    Gate.fromBool(axisDeclining(ctx.history, "reliability", 2)));

export const modularityDeclining: Rule<EscalationContext> = Gate.lift((ctx) =>
    Gate.fromBool(axisDeclining(ctx.history, "modularity", 2)));

export const reliabilityCampaignRule: Rule<EscalationContext> = Gate.or(
    (ctx) => consecutiveRejectsAbove(ctx.maxReject)(ctx),
    reliabilityDeclining,
);

export const modularityCampaignRule: Rule<EscalationContext> = Gate.or(
    (ctx) => consecutiveRejectsAbove(ctx.maxReject)(ctx),
    modularityDeclining,
);

export const radicalPlanRule: Rule<EscalationContext> = (ctx) =>
    consecutiveRejectsAbove(ctx.maxReject)(ctx);
