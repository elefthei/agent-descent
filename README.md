# agent-descent

A multi-agent loop system that simulates gradient descent using three independent AI agents to autonomously achieve a coding goal. Built on the [`@github/copilot-sdk`](https://github.com/github/copilot-sdk) for Node.js.

## How It Works

```
goal.md → Setup → [Research → Plan → Execute → Evaluate → Terminate?] → loop or done
```

An **Implementor** takes a step toward the goal (research → plan → execute). An **Evaluator** reviews the work — approving (git commit) or rejecting (git revert + feedback). A **Terminator** checks for convergence. The loop repeats until the goal is achieved or a safety cap is reached.

| Gradient Descent | Agent-Descent |
|-----------------|---------------|
| Parameter update | Implementor makes code changes |
| Loss evaluation | Evaluator reviews changes |
| Convergence check | Terminator decides STOP/CONTINUE |
| Backtrack | Evaluator rejects → git revert |

## Installation

```bash
npm install
```

Requires Node.js >= 20 and GitHub Copilot CLI authentication (`gh auth login`).

## Usage

Create a `goal.md` with three sections:

```markdown
## Goal to implement
Add a REST API with GET /users and POST /users endpoints using Express.

## Progress metric
API endpoints respond correctly, tests pass, error handling is present.

## Termination condition
All endpoints work, tests pass, and the evaluator finds no significant issues.
```

Run the loop:

```bash
npm start -- goal.md
```

### Options

```
agent-descent <goal.md> [options]

  --max-iterations N       Safety cap on loop iterations (default: 10)
  --implementor-model M    Model for implementor agent (default: claude-sonnet-4.5)
  --evaluator-model M      Model for evaluator agent (default: claude-sonnet-4.5)
  --terminator-model M     Model for terminator agent (default: gpt-4.1)
```

## Architecture

```
src/
├── index.ts              # Main loop orchestrator
├── agents/
│   ├── setup.ts          # One-time goal projection
│   ├── implementor.ts    # Research → Plan → Execute
│   ├── evaluator.ts      # Code review + approve/reject
│   └── terminator.ts     # Convergence detection
├── prompts/              # System prompts for each agent
├── tools/
│   └── decisions.ts      # Structured decision tools (Zod)
└── utils/
    ├── logger.ts         # Color-coded terminal output
    ├── git.ts            # Git operations
    └── goal.ts           # goal.md parser + projection

.descend/                 # Agent artifacts (git-tracked)
├── research/             # Implementor research notes
├── plan/                 # Implementor attack plans
├── implementor/          # Goal + execution log
├── evaluator/            # Goal + evaluation report
└── terminator/           # Goal file
```

All agent state flows through files in `.descend/` and git history. Each agent starts a fresh SDK session per iteration — no context bleed.

## Programmatic API

```typescript
import { CopilotClient } from "@github/copilot-sdk";
import { setup, descent } from "agent-descent";

const client = new CopilotClient({ logLevel: "none" });
await client.start();

const agents = setup("goal.md", {
    implementorModel: "claude-sonnet-4.5",  // default
    evaluatorModel: "claude-sonnet-4.5",    // default
    terminatorModel: "gpt-4.1",            // default
});

const result = await descent(client, agents, {
    maxIterations: 10,  // default
    maxRetries: 2,      // default
});

console.log(result);
// { iterations: 3, converged: true, reason: "Goal achieved" }

await client.stop();
```
