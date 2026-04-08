import { parseGoalFile, projectGoalFiles } from "../utils/goal.js";
import { gitCommitDescendOnly } from "../utils/git.js";
import { log } from "../utils/logger.js";

export async function runSetup(goalPath: string): Promise<void> {
    log.setup("🎯 Parsing goal.md and projecting per-agent goals...");

    const parsed = parseGoalFile(goalPath);
    projectGoalFiles(parsed);

    log.setup("✅ Goal files projected:");
    log.setup("   .descend/implementor/goal.md");
    log.setup("   .descend/evaluator/goal.md");
    log.setup("   .descend/terminator/goal.md");

    gitCommitDescendOnly(0, "setup: projected goal.md into per-agent goal files");
}
