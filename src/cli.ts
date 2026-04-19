#!/usr/bin/env npx tsx
/**
 * CLI entry point for agent-descent.
 */

import { CopilotClient } from "@github/copilot-sdk";
import { resolve } from "path";
import { setup, descent, recover } from "./descent.js";
import { log, setLogFile } from "./utils/logger.js";
import { loadState, saveState } from "./utils/state.js";
import { getHeadSha } from "./utils/git.js";
import { DEFAULT_MODEL, SUPPORTED_MODELS } from "./models.js";

// ── CLI Args ────────────────────────────────────────────────

interface CliArgs {
    goalPath: string;
    logFile: string | null;
    fresh: boolean;
    recover: boolean;
    maxIterations: number;
    maxReject: number;
    timeout: number;
    historyObserve: number;
    implementorModel: string;
    evaluatorModel: string;
    terminatorModel: string;
}

function parseArgs(): CliArgs {
    const args = process.argv.slice(2);
    let goalPath = "";
    let logFile: string | null = null;
    let fresh = false;
    let recover = false;
    let maxIterations = 10;
    let maxReject = 3;
    let timeout = 60;
    let historyObserve = 3;
    let implementorModel = DEFAULT_MODEL;
    let evaluatorModel = DEFAULT_MODEL;
    let terminatorModel = DEFAULT_MODEL;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === "--fresh") {
            fresh = true;
        } else if (arg === "--recover") {
            recover = true;
        } else if (arg === "--max-iterations" && args[i + 1]) {
            maxIterations = parseInt(args[++i]!, 10);
        } else if (arg === "--max-reject" && args[i + 1]) {
            maxReject = parseInt(args[++i]!, 10);
        } else if (arg === "--timeout" && args[i + 1]) {
            timeout = parseInt(args[++i]!, 10);
        } else if (arg === "--history-observe" && args[i + 1]) {
            historyObserve = parseInt(args[++i]!, 10);
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
            "Usage: agent-descent <goal.md> [--fresh] [--recover] [--max-iterations N] [--max-reject N] [--timeout MINUTES] [--history-observe N] [--log FILE] [--implementor-model M] [--evaluator-model M] [--terminator-model M]",
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
        recover,
        maxIterations,
        maxReject,
        timeout,
        historyObserve,
        implementorModel,
        evaluatorModel,
        terminatorModel,
    };
}

// ── Main ────────────────────────────────────────────────────

async function main() {
    const args = parseArgs();
    const timeoutMs = args.timeout * 60 * 1000;

    if (args.logFile) {
        setLogFile(resolve(args.logFile));
    }

    if (args.fresh) {
        const existing = loadState();
        if (existing) {
            existing.iteration = 0;
            existing.phase = "init";
            existing.baselineCommit = getHeadSha();
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
            historyObserve: args.historyObserve,
        });

        log.system(`\n✨ Agent-Descent complete. ${result.iterations} iteration(s), converged=${result.converged}`);

        // Recovery mode: if descent failed and --recover is set, analyze and retry
        if (!result.converged && args.recover) {
            log.system(`\n🔬 Descent failed — entering recovery mode...`);
            await recover(client, {
                model: args.implementorModel,
                reasoningEffort: "high",
                timeout: timeoutMs,
            });

            log.system("\n🚀 Re-running descent with recovery plan...");
            const agents2 = await setup(client, args.goalPath, {
                implementorModel: args.implementorModel,
                evaluatorModel: args.evaluatorModel,
                terminatorModel: args.terminatorModel,
                timeout: timeoutMs,
            });

            const result2 = await descent(client, agents2, {
                goalPath: args.goalPath,
                maxIterations: args.maxIterations,
                maxReject: args.maxReject,
                historyObserve: args.historyObserve,
            });

            log.system(`\n✨ Recovery run complete. ${result2.iterations} iteration(s), converged=${result2.converged}`);
        }
    } finally {
        await client.stop();
    }
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
