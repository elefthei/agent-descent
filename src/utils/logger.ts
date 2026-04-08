import type { CopilotSession } from "@github/copilot-sdk";

const COLORS: Record<string, string> = {
    "implementor:research": "\x1b[36m",
    "implementor:plan": "\x1b[36m",
    "implementor:exec": "\x1b[36m",
    "evaluator": "\x1b[33m",
    "evaluator:features": "\x1b[33m",
    "evaluator:reliability": "\x1b[33m",
    "evaluator:modularity": "\x1b[33m",
    "evaluator:symbolic": "\x1b[33m",
    "evaluator:synthesizer": "\x1b[33m",
    "terminator": "\x1b[35m",
    "setup": "\x1b[32m",
    "system": "\x1b[90m",
};

const RESET = "\x1b[0m";
const DIM = "\x1b[90m";
const MAX_ARG_LEN = 200;

function truncate(s: string, max: number = MAX_ARG_LEN): string {
    const oneLine = s.replace(/\n/g, "\\n");
    return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}

function formatToolArgs(toolName: string, args?: Record<string, unknown>): string {
    if (!args || Object.keys(args).length === 0) return "";

    // Show the most useful argument per tool type
    if (toolName === "bash" && args.command) return ` ${truncate(String(args.command))}`;
    if (toolName === "view" && args.path) return ` ${args.path}`;
    if (toolName === "edit" && args.path) return ` ${args.path}`;
    if (toolName === "create" && args.path) return ` ${args.path}`;
    if (toolName === "grep" && args.pattern) {
        const path = args.path ? ` in ${args.path}` : "";
        return ` "${args.pattern}"${path}`;
    }
    if (toolName === "glob" && args.pattern) return ` ${args.pattern}`;
    if (toolName === "web_fetch" && args.url) return ` ${truncate(String(args.url))}`;
    if (toolName === "read_agent" && args.agent_id) return ` ${args.agent_id}`;
    if (toolName === "write_agent" && args.agent_id) return ` ${args.agent_id}`;
    if ((toolName === "task" || toolName === "skill") && args.name) return ` ${args.name}`;

    // Fallback: show all args compactly
    try {
        return ` ${truncate(JSON.stringify(args))}`;
    } catch {
        return "";
    }
}

export function attachLogger(session: CopilotSession, agent: string): void {
    const color = COLORS[agent] ?? COLORS.system!;
    const prefix = `${color}[${agent.padEnd(22)}]${RESET}`;
    const dimPrefix = `${DIM}[${agent.padEnd(22)}]${RESET}`;
    let messageBuffer = "";
    let reasoningBuffer = "";

    function flushLines(buf: "message" | "reasoning") {
        const isReasoning = buf === "reasoning";
        const source = isReasoning ? reasoningBuffer : messageBuffer;
        const pfx = isReasoning ? `${DIM}${dimPrefix}` : prefix;
        const suffix = isReasoning ? RESET : "";
        let text = source;
        let newlineIdx: number;

        while ((newlineIdx = text.indexOf("\n")) !== -1) {
            const line = text.slice(0, newlineIdx);
            text = text.slice(newlineIdx + 1);
            if (line.length > 0) {
                console.log(`${pfx} ${line}${suffix}`);
            }
        }

        if (isReasoning) {
            reasoningBuffer = text;
        } else {
            messageBuffer = text;
        }
    }

    function flushAll() {
        flushLines("reasoning");
        if (reasoningBuffer.length > 0) {
            console.log(`${DIM}${dimPrefix} ${reasoningBuffer}${RESET}`);
            reasoningBuffer = "";
        }
        flushLines("message");
        if (messageBuffer.length > 0) {
            console.log(`${prefix} ${messageBuffer}`);
            messageBuffer = "";
        }
    }

    session.on((event) => {
        switch (event.type) {
            // ── Message streaming ──
            case "assistant.message_delta":
                messageBuffer += event.data.deltaContent;
                flushLines("message");
                break;
            case "assistant.message":
                flushAll();
                break;

            // ── Reasoning streaming ──
            case "assistant.reasoning_delta":
                reasoningBuffer += event.data.deltaContent;
                flushLines("reasoning");
                break;
            case "assistant.reasoning":
                flushAll();
                break;

            // ── Turn boundaries ──
            case "assistant.turn_start":
                flushAll();
                console.log(`${DIM}${prefix} ── turn ${event.data.turnId ?? "?"} ──${RESET}`);
                break;
            case "assistant.turn_end":
                flushAll();
                break;

            // ── Tool execution ──
            case "tool.execution_start": {
                flushAll();
                const args = formatToolArgs(event.data.toolName, event.data.arguments as Record<string, unknown> | undefined);
                console.log(`${prefix} ${DIM}[tool: ${event.data.toolName}]${RESET}${args}`);
                break;
            }
            case "tool.execution_complete": {
                const success = event.data.success;
                if (success) {
                    const resultStr = event.data.result ? truncate(String(event.data.result), 120) : "";
                    if (resultStr) {
                        console.log(`${prefix} ${DIM}[tool result]${RESET} ${resultStr}`);
                    }
                } else {
                    const errStr = event.data.error ? truncate(String(event.data.error), 200) : "unknown error";
                    console.log(`${prefix} \x1b[31m[tool error]\x1b[0m ${errStr}`);
                }
                break;
            }

            // ── Subagents ──
            case "subagent.started":
                console.log(`${prefix} ${DIM}→ subagent: ${event.data.agentDisplayName ?? event.data.agentName}${RESET}`);
                break;
            case "subagent.completed":
                console.log(`${prefix} ${DIM}← subagent: ${event.data.agentName}${RESET}`);
                break;
            case "subagent.failed":
                console.log(`${prefix} \x1b[31m✗ subagent failed: ${event.data.agentName} — ${event.data.error}\x1b[0m`);
                break;
            case "subagent.selected":
                console.log(`${prefix} ${DIM}agent selected: ${event.data.agentName}${RESET}`);
                break;
            case "subagent.deselected":
                console.log(`${prefix} ${DIM}agent deselected${RESET}`);
                break;

            // ── Session lifecycle ──
            case "session.idle":
                flushAll();
                break;
            case "session.task_complete":
                flushAll();
                console.log(`${prefix} ✅ task complete: ${event.data.summary ?? ""}`);
                break;
        }
    });
}

export const log = {
    system: (msg: string) =>
        console.log(
            `${COLORS.system}[system                ]${RESET} ${msg}`,
        ),
    setup: (msg: string) =>
        console.log(
            `${COLORS.setup}[setup                 ]${RESET} ${msg}`,
        ),
};
