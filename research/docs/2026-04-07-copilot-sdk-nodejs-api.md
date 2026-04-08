---
date: 2026-04-07 23:12:45 UTC
researcher: Copilot CLI
git_commit: 9cf0927ae80ce839178bd567f755b4d2a4d72ed5
branch: main
repository: agent-descent
topic: "Copilot SDK for Node.js — Full API Reference for Agent-Descent"
tags: [research, copilot-sdk, nodejs, api-reference, agents]
status: complete
last_updated: 2026-04-07
last_updated_by: Copilot CLI
---

# Research: Copilot SDK for Node.js — Full API Reference

## Research Question

What is the complete API surface of `@github/copilot-sdk` for Node.js, and how should it be used to build a multi-agent loop (implementor, evaluator, terminator) for the agent-descent project?

## Summary

The `@github/copilot-sdk` (v0.2.1, public preview) is a TypeScript SDK for programmatic control of GitHub Copilot CLI via JSON-RPC. It provides two main classes (`CopilotClient`, `CopilotSession`), support for custom tools (with Zod), streaming events, system prompt customization, custom agents with sub-agent delegation, and BYOK providers. The SDK manages a Copilot CLI child process automatically.

**Key architectural insight**: The SDK is a *transport layer* — it sends prompts over JSON-RPC to the Copilot CLI server, which runs the agentic tool-use loop. There is **no imperative `agent.spawn()` API**; sub-agents are defined upfront via `customAgents` config and the runtime auto-delegates to them.

---

## Detailed Findings

### 1. Installation & Setup

```bash
npm install @github/copilot-sdk
```

- **Package**: `@github/copilot-sdk` (npm, MIT license)
- **Version**: 0.2.1 (latest), 0.2.2-preview.0 (prerelease)
- **Requires**: Node.js >= 20.0.0
- **Dependencies**: `@github/copilot` (~129MB CLI runtime), `vscode-jsonrpc`, `zod` ^4.3.6
- **Module type**: ESM with CJS fallback
- **Exports**: `@github/copilot-sdk` (main) and `@github/copilot-sdk/extension`

### 2. Architecture

```
Your Application (agent-descent)
       ↓
  SDK Client  (CopilotClient)
       ↓ JSON-RPC (stdio or TCP)
  Copilot CLI (server mode — bundled with npm package)
       ↓
  LLM API (GitHub Models, OpenAI, Azure, Anthropic, Ollama, etc.)
```

- One `CopilotClient` manages one CLI server process
- Multiple independent `CopilotSession` instances can run on the same client
- Each session is an independent conversation with its own system prompt, tools, and agent config
- Sessions support `sendAndWait()` for synchronous-style interaction

### 3. Core API — CopilotClient

```typescript
import { CopilotClient, approveAll, defineTool } from "@github/copilot-sdk";

const client = new CopilotClient(options?: CopilotClientOptions);
```

**Constructor Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `cliPath` | `string?` | env or bundled | Path to CLI executable |
| `cliUrl` | `string?` | — | URL of existing CLI server (skip spawn) |
| `port` | `number?` | 0 (random) | Server port |
| `useStdio` | `boolean?` | `true` | Use stdio transport instead of TCP |
| `logLevel` | `string?` | `"info"` | Log level |
| `autoStart` | `boolean?` | `true` | Auto-start server on first use |
| `githubToken` | `string?` | — | GitHub token for auth |
| `useLoggedInUser` | `boolean?` | `true` | Use stored gh auth |

**Methods:**

| Method | Return | Description |
|--------|--------|-------------|
| `start()` | `Promise<void>` | Start CLI server & connect |
| `stop()` | `Promise<Error[]>` | Graceful stop |
| `forceStop()` | `Promise<void>` | Force kill CLI |
| `createSession(config)` | `Promise<CopilotSession>` | Create new session |
| `resumeSession(id, config?)` | `Promise<CopilotSession>` | Resume existing session |
| `ping(msg?)` | `Promise<{message, timestamp}>` | Check connectivity |
| `getState()` | `ConnectionState` | Current state |
| `listSessions(filter?)` | `Promise<SessionMetadata[]>` | List sessions |
| `deleteSession(id)` | `Promise<void>` | Delete session data |
| `listModels()` | `Promise<ModelInfo[]>` | List available models |

### 4. Core API — CopilotSession

```typescript
const session = await client.createSession({
    model: "gpt-5",                       // or "claude-sonnet-4.5", etc.
    streaming: true,                      // enable streaming deltas
    systemMessage: { content: "..." },    // system prompt
    tools: [ defineTool(...) ],           // custom tools
    customAgents: [ ... ],                // sub-agents
    onPermissionRequest: approveAll,      // REQUIRED
});
```

**SessionConfig:**

| Option | Type | Description |
|--------|------|-------------|
| `sessionId` | `string?` | Custom session ID |
| `model` | `string?` | Model to use |
| `reasoningEffort` | `"low"\|"medium"\|"high"\|"xhigh"?` | Reasoning effort |
| `streaming` | `boolean?` | Enable streaming deltas |
| `tools` | `Tool[]?` | Custom tools |
| `systemMessage` | `SystemMessageConfig?` | System prompt customization |
| `customAgents` | `CustomAgentConfig[]?` | Custom agent definitions |
| `agent` | `string?` | Pre-select agent by name |
| `infiniteSessions` | `InfiniteSessionConfig?` | Auto-compaction config |
| `provider` | `ProviderConfig?` | BYOK provider |
| `hooks` | `SessionHooks?` | Lifecycle hooks |
| `onPermissionRequest` | `PermissionHandler` | **REQUIRED** |
| `workingDirectory` | `string?` | CWD for the session |

**Session Methods:**

| Method | Return | Description |
|--------|--------|-------------|
| `send(options)` | `Promise<string>` | Send message (returns msg ID) |
| `sendAndWait(options, timeout?)` | `Promise<AssistantMessageEvent?>` | Send & wait for idle |
| `on(eventType, handler)` | `() => void` | Typed event subscription |
| `on(handler)` | `() => void` | Wildcard event subscription |
| `abort()` | `Promise<void>` | Abort current processing |
| `getMessages()` | `Promise<SessionEvent[]>` | Get all events |
| `disconnect()` | `Promise<void>` | Disconnect session |

### 5. Custom Tools (defineTool)

```typescript
import { z } from "zod";
import { defineTool } from "@github/copilot-sdk";

defineTool("tool_name", {
    description: "What this tool does",
    parameters: z.object({
        param1: z.string().describe("Description"),
    }),
    skipPermission: true,          // optional: bypass permission prompt
    overridesBuiltInTool: false,   // optional: override CLI built-in tools
    handler: async ({ param1 }) => {
        return { result: "some value" };  // JSON-serializable
    },
});
```

### 6. System Message Customization

Three modes:

**Append (default)**: Your content is appended after SDK-managed sections.
```typescript
systemMessage: { content: "Additional instructions here." }
```

**Customize**: Selectively override individual sections.
```typescript
import { SYSTEM_PROMPT_SECTIONS } from "@github/copilot-sdk";

systemMessage: {
    mode: "customize",
    sections: {
        tone: { action: "replace", content: "Be concise and technical." },
        code_change_rules: { action: "remove" },
        guidelines: { action: "append", content: "\n* Extra guideline" },
    },
    content: "Additional context.",
}
```

**Replace**: Full control (removes all guardrails).
```typescript
systemMessage: { mode: "replace", content: "You are a helpful assistant." }
```

**Available section IDs**: `identity`, `tone`, `tool_efficiency`, `environment_context`, `code_change_rules`, `guidelines`, `safety`, `tool_instructions`, `custom_instructions`, `last_instructions`

### 7. Streaming & Events

**Key event types:**

| Event | Description | Key Fields |
|-------|-------------|------------|
| `assistant.message` | Final assistant response | `content`, `toolRequests?` |
| `assistant.message_delta` | Streaming text chunk | `deltaContent` |
| `assistant.reasoning` | Final reasoning content | `content` |
| `assistant.reasoning_delta` | Streaming reasoning chunk | `deltaContent` |
| `assistant.turn_start` | Turn begins | `turnId` |
| `assistant.turn_end` | Turn ends | `turnId` |
| `tool.execution_start` | Tool execution begins | `toolCallId`, `toolName`, `arguments?` |
| `tool.execution_complete` | Tool execution ends | `toolCallId`, `success`, `result?`, `error?` |
| `session.idle` | Agent done processing | *(reliable "done" signal)* |
| `session.task_complete` | Task considered fulfilled | `summary` |
| `subagent.started` | Sub-agent launched | `toolCallId`, `agentName`, `agentDisplayName` |
| `subagent.completed` | Sub-agent finished | `toolCallId`, `agentName` |
| `subagent.failed` | Sub-agent errored | `toolCallId`, `agentName`, `error` |
| `subagent.selected` | Agent selected | `agentName`, `tools` |
| `subagent.deselected` | Returned to parent | *(empty)* |

### 8. Custom Agents & Sub-Agent Orchestration

```typescript
customAgents: [
    {
        name: "researcher",
        displayName: "Research Agent",
        description: "Explores codebases using read-only tools",
        tools: ["grep", "glob", "view"],
        prompt: "You are a research assistant. Do not modify files.",
    },
    {
        name: "editor",
        displayName: "Editor Agent",
        description: "Makes targeted code changes",
        tools: ["view", "edit", "bash"],
        prompt: "You are a code editor. Make minimal changes.",
    },
],
agent: "researcher",  // pre-select
```

**CustomAgentConfig:**

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | `string` | ✅ | Unique identifier |
| `displayName` | `string?` | | Human-readable name |
| `description` | `string?` | | Helps runtime select the agent |
| `tools` | `string[] \| null?` | | Tool allow-list (`null` = all) |
| `prompt` | `string` | ✅ | System prompt |
| `mcpServers` | `object?` | | MCP servers for this agent |
| `infer` | `boolean?` | | Auto-selection by runtime (default: true) |

**⚠️ Important**: Agents don't programmatically "spawn" other agents. You define custom agents upfront in `customAgents`, and the CLI runtime auto-delegates as sub-agents. There is no imperative `agent.spawn()` API.

### 9. Session Hooks

```typescript
hooks: {
    onPreToolUse: async (input) => ({
        permissionDecision: "allow",
        modifiedArgs: input.toolArgs,
        additionalContext: "Extra context",
    }),
    onPostToolUse: async (input) => ({ additionalContext: "Post notes" }),
    onUserPromptSubmitted: async (input) => ({ modifiedPrompt: input.prompt }),
    onSessionStart: async (input) => ({ additionalContext: "Init context" }),
    onSessionEnd: async (input) => { /* cleanup */ },
    onErrorOccurred: async (input) => ({ errorHandling: "retry" }),
}
```

### 10. Multiple Sessions on One Client

```typescript
const session1 = await client.createSession({ model: "gpt-5" });
const session2 = await client.createSession({ model: "claude-sonnet-4.5" });

// Both are independent
await session1.sendAndWait({ prompt: "Hello from session 1" });
await session2.sendAndWait({ prompt: "Hello from session 2" });
```

### 11. Permission Handling

```typescript
import { approveAll } from "@github/copilot-sdk";

// Simple: approve all
onPermissionRequest: approveAll

// Custom: inspect each request
onPermissionRequest: (request) => {
    // request.kind: "shell" | "write" | "read" | "mcp" | "custom-tool" | "url" | "memory" | "hook"
    // request.toolName, request.fileName, request.fullCommandText
    if (request.kind === "shell") return { kind: "denied-interactively-by-user" };
    return { kind: "approved" };
}
```

### 12. Fleet (Experimental)

Available via session RPC:
```typescript
session.rpc.fleet.start({ prompt? })  // → { started }
```

Minimal documentation available — appears to be an experimental feature for running multiple agents concurrently.

### 13. Sample Code — chat.ts

```typescript
import { CopilotClient, approveAll, type SessionEvent } from "@github/copilot-sdk";
import * as readline from "node:readline";

async function main() {
    const client = new CopilotClient();
    const session = await client.createSession({
        onPermissionRequest: approveAll,
    });

    session.on((event: SessionEvent) => {
        let output: string | null = null;
        if (event.type === "assistant.reasoning") {
            output = `[reasoning: ${event.data.content}]`;
        } else if (event.type === "tool.execution_start") {
            output = `[tool: ${event.data.toolName}]`;
        }
        if (output) console.log(`\x1b[34m${output}\x1b[0m`);
    });

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const prompt = (q: string) => new Promise<string>((r) => rl.question(q, r));

    console.log("Chat with Copilot (Ctrl+C to exit)\n");

    while (true) {
        const input = await prompt("You: ");
        if (!input.trim()) continue;
        console.log();
        const reply = await session.sendAndWait({ prompt: input });
        console.log(`\nAssistant: ${reply?.data.content}\n`);
    }
}

main().catch(console.error);
```

---

## Code References

- SDK README: https://github.com/github/copilot-sdk/blob/main/nodejs/README.md
- SDK package.json: https://github.com/github/copilot-sdk/blob/main/nodejs/package.json
- Main exports: https://github.com/github/copilot-sdk/blob/main/nodejs/src/index.ts
- Client implementation: https://github.com/github/copilot-sdk/blob/main/nodejs/src/client.ts
- Session implementation: https://github.com/github/copilot-sdk/blob/main/nodejs/src/session.ts
- Type definitions: https://github.com/github/copilot-sdk/blob/main/nodejs/src/types.ts
- Extension API: https://github.com/github/copilot-sdk/blob/main/nodejs/src/extension.ts
- Chat sample: https://github.com/github/copilot-sdk/blob/main/nodejs/samples/chat.ts
- Agent loop docs: https://github.com/github/copilot-sdk/blob/main/docs/features/agent-loop.md
- Custom agents docs: https://github.com/github/copilot-sdk/blob/main/docs/features/custom-agents.md
- Streaming/events docs: https://github.com/github/copilot-sdk/blob/main/docs/features/streaming-events.md

## Architecture Documentation

### Authentication Options
1. **GitHub signed-in user** (default) — uses `gh auth` or stored OAuth
2. **GitHub token** — via `githubToken` option or `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN` env vars
3. **BYOK** — use your own OpenAI/Anthropic/Azure/Ollama keys via `provider` config

### Agent Tool-Use Loop
When `session.send({ prompt })` is called, the CLI enters a tool-use loop:
1. User prompt → LLM API call (one "turn")
2. If response has `toolRequests` → execute tools → collect results → next turn → loop
3. If no `toolRequests` → final text response → `session.idle`

A single user message typically triggers **multiple turns**. The model decides when to stop.

### Event-Driven Session Model
- All events follow an envelope: `{ id, timestamp, parentId, ephemeral?, type, data }`
- Use `session.idle` as the reliable "done" signal (always emitted)
- Use `session.task_complete` for "task fulfilled" (optional, model-dependent)
- `sendAndWait()` internally waits for `session.idle`

---

## Open Questions

1. **Fleet API**: `session.rpc.fleet.start()` exists but is undocumented. Could be useful for parallel agent execution.
2. **Extension API**: `joinSession` from `@github/copilot-sdk/extension` allows extensions to join existing sessions — could be an alternative architecture for multi-agent coordination.
3. **Infinite Sessions**: Auto-compaction may interfere with short-lived agent sessions. May need `infiniteSessions: { enabled: false }` for stateless agents.
4. **Session cleanup**: After `session.disconnect()`, session data persists on disk. Need `client.deleteSession(id)` for full cleanup.
5. **Concurrent sessions**: SDK supports multiple sessions on one client — but unclear if there are practical limits.
