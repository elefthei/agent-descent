/**
 * Escalation logic — campaigns, verification, and radical plans.
 * Extracted from descent.ts for modularity.
 */

import type { CopilotClient } from "@github/copilot-sdk";
import {
    runSymbolicCheck,
    radicalPlanImplementor,
    reliabilityCampaign,
    modularityCampaign,
} from "./agents/index.js";
import { gitRevertToBaseline } from "./utils/git.js";
import { log } from "./utils/logger.js";
import { saveState, consecutiveRejects, loadGoalWeights } from "./utils/state.js";
import { readFileOrDefault } from "./utils/files.js";
import { readFileSync } from "fs";
import { withRetry } from "./utils/retry.js";
import { CampaignError, type CampaignType } from "./errors.js";
import { reliabilityCampaignRule, modularityCampaignRule, radicalPlanRule, CAMPAIGN_WEIGHT_THRESHOLD, type EscalationContext } from "./rules/campaigns.js";
import type { LoopContext } from "./descent.js";

// ── Campaign Verification ───────────────────────────────────

/**
 * Run the symbolic evaluator after a campaign to verify it didn't break the build.
 * Returns true if the campaign is safe to keep, false if it was reverted.
 */
export async function verifyCampaign(
    ctx: LoopContext,
    campaignName: CampaignType,
    baseline: string,
): Promise<boolean> {
    log.system(`   🔍 Verifying ${campaignName} campaign (symbolic check)...`);
    try {
        const result = await runSymbolicCheck(ctx.client, ctx.agents.evaluator, baseline);

        if (result.feedback.includes("FAIL:")) {
            log.system(`   ❌ ${campaignName} campaign broke the build — reverting`);
            log.system(`      Findings: ${result.feedback}`);
            gitRevertToBaseline(baseline);
            return false;
        }
        log.system(`   ✅ ${campaignName} campaign verified`);
        return true;
    } catch (err) {
        log.system(`   ⚠️ Verification failed for ${campaignName}: ${(err as Error).message} — keeping changes`);
        return true;
    }
}

// ── Escalation ──────────────────────────────────────────────

/** Run escalation campaigns. Returns true if any campaign executed. */
export async function runEscalation(ctx: LoopContext, baseline: string): Promise<boolean> {
    const escCtx: EscalationContext = {
        history: ctx.state.history,
        maxReject: ctx.options.maxReject ?? 3,
    };
    const weights = loadGoalWeights();

    let runReliability = await reliabilityCampaignRule(escCtx) === "SUCCESS";
    let runModularity = await modularityCampaignRule(escCtx) === "SUCCESS";
    const runRadical = await radicalPlanRule(escCtx) === "SUCCESS";

    // Skip campaigns for axes with negligible goal weight
    if (runReliability && weights.reliability < CAMPAIGN_WEIGHT_THRESHOLD) {
        log.system(`   ⏭️ Skipping reliability campaign (weight ${(weights.reliability * 100).toFixed(0)}% < ${(CAMPAIGN_WEIGHT_THRESHOLD * 100).toFixed(0)}% threshold)`);
        runReliability = false;
    }
    if (runModularity && weights.modularity < CAMPAIGN_WEIGHT_THRESHOLD) {
        log.system(`   ⏭️ Skipping modularity campaign (weight ${(weights.modularity * 100).toFixed(0)}% < ${(CAMPAIGN_WEIGHT_THRESHOLD * 100).toFixed(0)}% threshold)`);
        runModularity = false;
    }

    if (!runReliability && !runModularity && !runRadical) return false;

    log.system("\n🚨 Escalation triggered...");
    let campaignsRan = false;

    if (runReliability) {
        log.system("   🛡️ Reliability campaign (scores declining or rejection streak)...");
        ctx.state.phase = "campaign:reliability";
        saveState(ctx.state);
        try {
            const r = await withRetry((cfg) => reliabilityCampaign.run(ctx.client, cfg), ctx.agents.implementor, ctx.maxRetries);
            log.system(`   ← [${[...r.kinds].join(", ")}] ${r.feedback}`);
            if (await verifyCampaign(ctx, "reliability", baseline)) {
                campaignsRan = true;
            }
        } catch (err) {
            throw new CampaignError("reliability", (err as Error).message);
        }
    }

    if (runModularity) {
        log.system("   🏗️ Modularity campaign (scores declining or rejection streak)...");
        ctx.state.phase = "campaign:modularity";
        saveState(ctx.state);
        try {
            const r = await withRetry((cfg) => modularityCampaign.run(ctx.client, cfg), ctx.agents.implementor, ctx.maxRetries);
            log.system(`   ← [${[...r.kinds].join(", ")}] ${r.feedback}`);
            if (await verifyCampaign(ctx, "modularity", baseline)) {
                campaignsRan = true;
            }
        } catch (err) {
            throw new CampaignError("modularity", (err as Error).message);
        }
    }

    if (runRadical && ctx.options.goalPath) {
        log.system("   🚨 Radical plan (rethink from goal.md)...");
        ctx.state.phase = "evaluator:radical";
        saveState(ctx.state);

        const rejectStreak = consecutiveRejects(ctx.state.history);
        const failureReports = ctx.state.history.slice(-rejectStreak).map((rec) => {
            const archived = readFileOrDefault(`.descend/history/iteration-${rec.iteration}/evaluator/report.md`, "");
            return archived || readFileOrDefault(".descend/evaluator/report.md", "");
        }).filter(Boolean);

        const goalContent = readFileSync(ctx.options.goalPath, "utf-8");
        try {
            await withRetry((cfg) => radicalPlanImplementor.run(ctx.client, cfg, { goalContent, failureReports }), ctx.agents.evaluator, ctx.maxRetries);
            log.system("   📋 RADICAL PLAN written");
            campaignsRan = true;
        } catch (err) {
            throw new CampaignError("radical-plan", (err as Error).message);
        }
    }

    return campaignsRan;
}
