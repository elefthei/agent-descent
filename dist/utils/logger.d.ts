import type { CopilotSession } from "@github/copilot-sdk";
export declare function setLogFile(path: string): void;
export declare function attachLogger(session: CopilotSession, agent: string): void;
export declare const log: {
    system: (msg: string) => void;
    setup: (msg: string) => void;
};
