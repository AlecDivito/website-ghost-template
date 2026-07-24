/**
 * Shared SSE client for ghost-chat-agent `POST /v1/chat`.
 * Sends chat_id + session_id so the agent can forward X-Chat-Id / X-Session-Id to llm-proxy.
 */

/**
 * @param {string} agentUrl
 * @param {object[]} messages
 * @param {(eventName: string, data: object) => void} onEvent
 * @param {{ signal?: AbortSignal, chatId?: string, sessionId?: string }} [options]
 */
export async function streamChat(agentUrl, messages, onEvent, options = {}) {
    const { signal, chatId, sessionId } = options;

    /** @type {Record<string, unknown>} */
    const body = { messages };
    if (chatId) {
        body.chat_id = chatId;
    }
    if (sessionId) {
        body.session_id = sessionId;
    }

    const res = await fetch(`${agentUrl}/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(body),
        signal,
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Chat failed (${res.status})`);
    }

    if (!res.body) {
        throw new Error('No response stream');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let eventName = 'message';

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n');
        buffer = chunks.pop() || '';

        for (const line of chunks) {
            if (line.startsWith('event:')) {
                eventName = line.slice(6).trim();
                continue;
            }
            if (line.startsWith('data:')) {
                const raw = line.slice(5).trim();
                if (!raw) {
                    continue;
                }
                try {
                    onEvent(eventName, JSON.parse(raw));
                } catch {
                    // ignore malformed SSE payloads
                }
                eventName = 'message';
            }
        }
    }
}
