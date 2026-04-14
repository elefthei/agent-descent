import { CopilotClient } from "@github/copilot-sdk";
import { resolve } from "path";
import { setup, descent } from "./descent.js";
import { log, setLogFile } from "./utils/logger.js";
import { DEFAULT_MODEL, SUPPORTED_MODELS } from "./models.js";

export { setup, descent } from "./descent.js";
export { DEFAULT_MODEL, MODEL_CHAIN, getNextModel } from "./models.js";
export type {
    AgentConfig,
    AgentConfigs,
    Agents,
    SetupOptions,
    DescentOptions,
    DescentResult,
} from "./descent.js";
export type { Agent, Implementor, Evaluator, Validator, EvaluatorResult, EvalOrchestratorResult, GatekeeperResult, ImplementorKind, ImplementorResult, EvalResults, GoalWeights } from "./types.js";
export { Gate, type Tri, type Rule } from "./rules.js";
export { weightedScore, weightedGaps, DEFAULT_GOAL_WEIGHTS } from "./types.js";
export { DescentError, CampaignError, IterationError } from "./errors.js";
export type { CampaignType } from "./errors.js";
export { llmAsJudge } from "./agents/llm-judge.js";

// ── CLI ─────────────────────────────────────────────────────

interface CliArgs {
    goalPath: string;
    logFile: string | null;
    fresh: boolean;
    maxIterations: number;
    maxReject: number;
    timeout: number;
    implementorModel: string;
    evaluatorModel: string;
    terminatorModel: string;
}

function parseArgs(): CliArgs {
    const args = process.argv.slice(2);
    let goalPath = "";
    let logFile: string | null = null;
    let fresh = false;
    let maxIterations = 10;
    let maxReject = 3;
    let timeout = 60;
    let implementorModel = DEFAULT_MODEL;
    let evaluatorModel = DEFAULT_MODEL;
    let terminatorModel = DEFAULT_MODEL;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === "--fresh") {
            fresh = true;
        } else if (arg === "--max-iterations" && args[i + 1]) {
            maxIterations = parseInt(args[++i]!, 10);
        } else if (arg === "--max-reject" && args[i + 1]) {
            maxReject = parseInt(args[++i]!, 10);
        } else if (arg === "--timeout" && args[i + 1]) {
            timeout = parseInt(args[++i]!, 10);
        } else if (arg === "--log" && args[i + 1]) {
            logFile = args[++i]!;
        } else if (arg === "--implementor-model" && args[i + 1]) {
            implementorModel = args[++i]!;
        } else if (arg === "--evaluator-model" && args[i + 1]) {
            evaluatorModel = args[++i]!;
        } else if (arg === "--terminator-model" && args[i + 1]) {
            terminatorModel = args[++i]!;
        } else if (!arg.startsWith("--")) {
            goalPath = arg;
        }
    }

    if (!goalPath) {
        console.error(
            "Usage: agent-descent <goal.md> [--fresh] [--max-iterations N] [--max-reject N] [--timeout MINUTES] [--log FILE] [--implementor-model M] [--evaluator-model M] [--terminator-model M]",
        );
        console.error(`\nSupported models: ${[...SUPPORTED_MODELS].join(", ")}`);
        process.exit(1);
    }

    for (const [flag, value] of [
        ["--implementor-model", implementorModel],
        ["--evaluator-model", evaluatorModel],
        ["--terminator-model", terminatorModel],
    ] as const) {
        if (!SUPPORTED_MODELS.has(value)) {
            console.error(`Invalid model for ${flag}: "${value}"`);
            console.error(`Supported: ${[...SUPPORTED_MODELS].join(", ")}`);
            process.exit(1);
        }
    }

    return {
        goalPath: resolve(goalPath),
        logFile,
        fresh,
        maxIterations,
        maxReject,
        timeout,
        implementorModel,
        evaluatorModel,
        terminatorModel,
    };
}

async function main() {
    const args = parseArgs();
    const timeoutMs = args.timeout * 60 * 1000;

    if (args.logFile) {
        setLogFile(resolve(args.logFile));
    }

    if (args.fresh) {
        const { loadState, saveState } = await import("./utils/state.js");
        const existing = loadState();
        if (existing) {
            existing.iteration = 0;
            existing.phase = "init";
            existing.baselineCommit = (await import("./utils/git.js")).getHeadSha();
            saveState(existing);
            log.system(`🔄 Fresh start (--fresh) — reset iteration counter, kept ${existing.history.length} history records`);
        }
    }

    log.system("🚀 Agent-Descent starting...");
    log.system(`   Goal: ${args.goalPath}`);
    log.system(`   Max iterations: ${args.maxIterations}`);
    log.system(`   Timeout: ${args.timeout} minutes per agent session`);
    if (args.logFile) log.system(`   Log: ${resolve(args.logFile)}`);

    const client = new CopilotClient({ logLevel: "none" });
    await client.start();

    try {
        const agents = await setup(client, args.goalPath, {
            implementorModel: args.implementorModel,
            evaluatorModel: args.evaluatorModel,
            terminatorModel: args.terminatorModel,
            timeout: timeoutMs,
        });

        const result = await descent(client, agents, {
            goalPath: args.goalPath,
            maxIterations: args.maxIterations,
            maxReject: args.maxReject,
        });

        log.system(`\n✨ Agent-Descent complete. ${result.iterations} iteration(s), converged=${result.converged}`);
    } finally {
        await client.stop();
    }
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
