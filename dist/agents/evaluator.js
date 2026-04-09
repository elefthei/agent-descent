import { approveAll } from "@github/copilot-sdk";
import { createAxisScoreTool, createSymbolicReportTool, } from "../tools/decisions.js";
import { DEFAULT_TIMEOUT } from "../types.js";
import { attachLogger, log } from "../utils/logger.js";
import { getGitDiff } from "../utils/git.js";
import { readFileOrDefault, readDirContents } from "../utils/files.js";
import { loadPrompt } from "../utils/prompt.js";
function buildEvalContext(baselineSha) {
    return {
        evalGoal: readFileOrDefault(".descend/evaluator/goal.md", "No evaluator goal found."),
        gitDiff: getGitDiff(baselineSha),
        implReport: readFileOrDefault(".descend/implementor/report.md", "No implementor report found."),
        researchNotes: readDirContents(".descend/research"),
        planNotes: readDirContents(".descend/plan"),
    };
}
function buildAxisPrompt(evalCtx) {
    return [
        "## Evaluator Goal",
        evalCtx.evalGoal,
        "",
        "## Git Diff",
        "```diff",
        evalCtx.gitDiff || "(no changes)",
        "```",
        "",
        "## Implementor Report",
        evalCtx.implReport,
        "",
        "Score this diff on your axis. Call submit_axis_score with your score and issues.",
    ].join("\n");
}
const AXIS_PROMPTS = {
    features: "evaluator-features",
    reliability: "evaluator-reliability",
    modularity: "evaluator-modularity",
};
class AxisEvaluatorAgent {
    name;
    axis;
    constructor(axis) {
        this.axis = axis;
        this.name = `evaluator:${axis}`;
    }
    async run(client, config, ctx) {
        const { tool, getResult } = createAxisScoreTool(this.axis);
        const session = await client.createSession({
            workingDirectory: process.cwd(),
            model: config.model,
            reasoningEffort: config.reasoningEffort ?? "high",
            systemMessage: { mode: "replace", content: loadPrompt(AXIS_PROMPTS[this.axis], { CWD: process.cwd() }) },
            tools: [tool],
            onPermissionRequest: approveAll,
            infiniteSessions: { enabled: false },
            streaming: true,
        });
        attachLogger(session, this.name);
        await session.sendAndWait({ prompt: buildAxisPrompt(ctx) }, config.timeout ?? DEFAULT_TIMEOUT);
        await session.disconnect();
        await client.deleteSession(session.sessionId);
        const result = getResult();
        if (!result) {
            throw new Error(`${this.name} did not call submit_axis_score`);
        }
        return result;
    }
}
// ── Symbolic Evaluator Agent ────────────────────────────────
class SymbolicEvaluatorAgent {
    name = "evaluator:symbolic";
    async run(client, config, ctx) {
        const { tool, getResult } = createSymbolicReportTool();
        const session = await client.createSession({
            workingDirectory: process.cwd(),
            model: config.model,
            reasoningEffort: config.reasoningEffort ?? "high",
            systemMessage: { mode: "replace", content: loadPrompt("evaluator-symbolic", { CWD: process.cwd() }) },
            tools: [tool],
            onPermissionRequest: approveAll,
            infiniteSessions: { enabled: false },
            streaming: true,
        });
        attachLogger(session, this.name);
        const prompt = [
            "## Evaluator Goal",
            ctx.evalGoal,
            "",
            "## Git Diff",
            "```diff",
            ctx.gitDiff || "(no changes)",
            "```",
            "",
            "## Implementor Report",
            ctx.implReport,
            "",
            "Discover what symbolic checks are available, run them, and report findings.",
            "Call submit_symbolic_report with your results.",
        ].join("\n");
        await session.sendAndWait({ prompt }, config.timeout ?? DEFAULT_TIMEOUT);
        await session.disconnect();
        await client.deleteSession(session.sessionId);
        const result = getResult();
        if (!result) {
            throw new Error("evaluator:symbolic did not call submit_symbolic_report");
        }
        return result;
    }
}
class SynthesizerAgent {
    name = "evaluator:synthesizer";
    async run(client, config, ctx) {
        const session = await client.createSession({
            workingDirectory: process.cwd(),
            model: config.model,
            reasoningEffort: config.reasoningEffort ?? "high",
            systemMessage: { mode: "replace", content: loadPrompt("evaluator-synthesizer", { CWD: process.cwd() }) },
            onPermissionRequest: approveAll,
            infiniteSessions: { enabled: false },
            streaming: true,
        });
        attachLogger(session, this.name);
        const prompt = [
            "## Decision",
            ctx.decision === "approve" ? "APPROVED" : "REJECTED",
            "",
            "## Axis Scores",
            `- Features: ${ctx.scores.features}/100`,
            `- Reliability: ${ctx.scores.reliability}/100`,
            `- Modularity: ${ctx.scores.modularity}/100`,
            "",
            "## Features Issues",
            ctx.issues.features.length === 0 ? "No issues." : ctx.issues.features.map(i => `- ${i}`).join("\n"),
            "",
            "## Reliability Issues",
            ctx.issues.reliability.length === 0 ? "No issues." : ctx.issues.reliability.map(i => `- ${i}`).join("\n"),
            "",
            "## Modularity Issues",
            ctx.issues.modularity.length === 0 ? "No issues." : ctx.issues.modularity.map(i => `- ${i}`).join("\n"),
            "",
            "## Symbolic Checking (advisory — no score)",
            `**Available checks**: ${ctx.symbolic.availableChecks.length === 0 ? "none found" : ctx.symbolic.availableChecks.join(", ")}`,
            ctx.symbolic.findings.length > 0
                ? `**Findings**:\n${ctx.symbolic.findings.map(f => `- ${f}`).join("\n")}`
                : "**Findings**: none",
            ctx.symbolic.suggestions.length > 0
                ? `**Suggestions**:\n${ctx.symbolic.suggestions.map(s => `- ${s}`).join("\n")}`
                : "**Suggestions**: none",
            "",
            "## Evaluator Goal",
            ctx.evalCtx.evalGoal,
            "",
            "Write the final evaluation report to .descend/evaluator/report.md.",
            "Include a Symbolic Checking section with the findings and suggestions above.",
        ].join("\n");
        await session.sendAndWait({ prompt }, config.timeout ?? DEFAULT_TIMEOUT);
        await session.disconnect();
        await client.deleteSession(session.sessionId);
    }
}
// ── Evaluator Orchestrator ──────────────────────────────────
const APPROVE_THRESHOLD = 50;
const featuresAgent = new AxisEvaluatorAgent("features");
const reliabilityAgent = new AxisEvaluatorAgent("reliability");
const modularityAgent = new AxisEvaluatorAgent("modularity");
const symbolicAgent = new SymbolicEvaluatorAgent();
const synthesizerAgent = new SynthesizerAgent();
class EvaluatorOrchestrator {
    name = "evaluator";
    agents = [featuresAgent, reliabilityAgent, modularityAgent, symbolicAgent, synthesizerAgent];
    async run(client, config, input) {
        const evalCtx = buildEvalContext(input.baselineSha);
        // Run three axis evaluators + symbolic checker sequentially
        log.system("   → evaluator:features");
        const featuresResult = await featuresAgent.run(client, config, evalCtx);
        log.system(`   ← features: ${featuresResult.score}/100`);
        log.system("   → evaluator:reliability");
        const reliabilityResult = await reliabilityAgent.run(client, config, evalCtx);
        log.system(`   ← reliability: ${reliabilityResult.score}/100`);
        log.system("   → evaluator:modularity");
        const modularityResult = await modularityAgent.run(client, config, evalCtx);
        log.system(`   ← modularity: ${modularityResult.score}/100`);
        log.system("   → evaluator:symbolic");
        const symbolicResult = await symbolicAgent.run(client, config, evalCtx);
        log.system(`   ← symbolic: ${symbolicResult.availableChecks.length} checks, ${symbolicResult.findings.length} findings`);
        // Derive decision (symbolic does NOT affect approval — advisory only)
        const scores = {
            features: featuresResult.score,
            reliability: reliabilityResult.score,
            modularity: modularityResult.score,
        };
        const issues = {
            features: featuresResult.issues,
            reliability: reliabilityResult.issues,
            modularity: modularityResult.issues,
        };
        const maxScore = Math.max(scores.features, scores.reliability, scores.modularity);
        const decision = maxScore >= APPROVE_THRESHOLD ? "approve" : "reject";
        const allIssues = [...issues.features, ...issues.reliability, ...issues.modularity];
        // Run synthesizer to write report.md (includes symbolic findings)
        log.system("   → evaluator:synthesizer");
        await synthesizerAgent.run(client, config, {
            evalCtx,
            scores,
            issues,
            symbolic: symbolicResult,
            decision,
            remainingWork: allIssues,
        });
        log.system("   ← report.md written");
        return {
            decision,
            summary: `features=${scores.features}, reliability=${scores.reliability}, modularity=${scores.modularity} (max=${maxScore})`,
            scores,
            issues,
            remainingWork: allIssues,
            testsStatus: "none",
        };
    }
}
const evaluatorOrchestrator = new EvaluatorOrchestrator();
// ── Public API (unchanged signature) ────────────────────────
export async function runEvaluator(client, ctx, baselineSha) {
    return evaluatorOrchestrator.run(client, ctx, { baselineSha });
}
export async function runRadicalPlan(client, ctx, goalContent, failureReports) {
    const session = await client.createSession({
        workingDirectory: process.cwd(),
        model: ctx.model,
        reasoningEffort: ctx.reasoningEffort ?? "high",
        systemMessage: { mode: "replace", content: loadPrompt("evaluator-radical", { CWD: process.cwd() }) },
        onPermissionRequest: approveAll,
        infiniteSessions: { enabled: false },
        streaming: true,
    });
    attachLogger(session, "evaluator");
    const failureSection = failureReports
        .map((report, i) => `### Rejection ${i + 1}\n\n${report}`)
        .join("\n\n---\n\n");
    await session.sendAndWait({
        prompt: [
            "## Original Goal",
            goalContent,
            "",
            "## Cumulative Failure Reports (most recent last)",
            failureSection,
            "",
            "The implementor has been rejected multiple times in a row.",
            "Analyze the pattern of failures and write a RADICAL PLAN to .descend/evaluator/report.md.",
            "Think from first principles — start from the goal, not from the failed approaches.",
        ].join("\n"),
    }, ctx.timeout ?? DEFAULT_TIMEOUT);
    await session.disconnect();
    await client.deleteSession(session.sessionId);
}
//# sourceMappingURL=evaluator.js.map