import type { CopilotClient, CopilotSession } from "@github/copilot-sdk";
import type { SessionConfig } from "@github/copilot-sdk";

/**
 * Run a function with a managed CopilotSession.
 * Guarantees disconnect + deleteSession cleanup even on error.
 * The cleanup errors are swallowed to avoid masking the original error.
 */
export async function withSession<T>(
    client: CopilotClient,
    config: SessionConfig,
    fn: (session: CopilotSession) => Promise<T>,
): Promise<T> {
    const session = await client.createSession(config);
    try {
        return await fn(session);
    } finally {
        try { await session.disconnect(); } catch { /* swallow cleanup error */ }
        try { await client.deleteSession(session.sessionId); } catch { /* swallow cleanup error */ }
    }
}
