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

export function attachLogger(session: CopilotSession, agent: string): void {
    const color = COLORS[agent] ?? COLORS.system!;
    const prefix = `${color}[${agent.padEnd(22)}]${RESET}`;
    let buffer = "";

    function flushLines() {
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, newlineIdx);
            buffer = buffer.slice(newlineIdx + 1);
            if (line.length > 0) {
                console.log(`${prefix} ${line}`);
            }
        }
    }

    function flushAll() {
        flushLines();
        if (buffer.length > 0) {
            console.log(`${prefix} ${buffer}`);
            buffer = "";
        }
    }

    session.on((event) => {
        switch (event.type) {
            case "assistant.message_delta":
                buffer += event.data.deltaContent;
                flushLines();
                break;
            case "tool.execution_start":
                flushAll();
                console.log(`${prefix} [tool: ${event.data.toolName}]`);
                break;
            case "assistant.reasoning_delta":
                // Reasoning goes to a separate dim stream, unbuffered
                process.stdout.write(
                    `\x1b[90m${prefix} ${event.data.deltaContent}${RESET}`,
                );
                break;
            case "session.idle":
                flushAll();
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
