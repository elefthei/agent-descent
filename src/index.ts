import { CopilotClient } from "@github/copilot-sdk";
import { resolve } from "path";
import { setup, descent } from "./descent.js";
import { log } from "./utils/logger.js";

export { setup, descent } from "./descent.js";
export type {
    AgentConfig,
    Agents,
    SetupOptions,
    DescentOptions,
    DescentResult,
} from "./descent.js";
export type { Agent, Orchestrator } from "./types.js";

// ── CLI ─────────────────────────────────────────────────────

interface CliArgs {
    goalPath: string;
    maxIterations: number;
    maxReject: number;
    implementorModel: string;
    evaluatorModel: string;
    terminatorModel: string;
}

function parseArgs(): CliArgs {
    const args = process.argv.slice(2);
    let goalPath = "";
    let maxIterations = 10;
    let maxReject = 3;
    let implementorModel = "claude-opus-4.6";
    let evaluatorModel = "claude-opus-4.6";
    let terminatorModel = "claude-opus-4.6";

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === "--max-iterations" && args[i + 1]) {
            maxIterations = parseInt(args[++i]!, 10);
        } else if (arg === "--max-reject" && args[i + 1]) {
            maxReject = parseInt(args[++i]!, 10);
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
            "Usage: agent-descent <goal.md> [--max-iterations N] [--max-reject N] [--implementor-model M] [--evaluator-model M] [--terminator-model M]",
        );
        process.exit(1);
    }

    return {
        goalPath: resolve(goalPath),
        maxIterations,
        maxReject,
        implementorModel,
        evaluatorModel,
        terminatorModel,
    };
}

async function main() {
    const args = parseArgs();

    log.system("🚀 Agent-Descent starting...");
    log.system(`   Goal: ${args.goalPath}`);
    log.system(`   Max iterations: ${args.maxIterations}`);

    const client = new CopilotClient({ logLevel: "none" });
    await client.start();

    try {
        const agents = setup(args.goalPath, {
            implementorModel: args.implementorModel,
            evaluatorModel: args.evaluatorModel,
            terminatorModel: args.terminatorModel,
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
