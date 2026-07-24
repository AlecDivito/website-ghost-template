/**
 * Client-side chat / session ids for ghost-chat-agent → llm-proxy.
 *
 * - session_id: stable anonymous visitor id (localStorage)
 * - chat_id: one conversation branch (sessionStorage); forwarded as X-Chat-Id upstream
 */

const SESSION_KEY = 'ghost-chat-session-id';
const CHAT_KEY = 'ghost-chat-id';
const HISTORY_KEY = 'ghost-chat-history';
export const CONTINUE_KEY = 'hero-chat-continue';

function randomId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function read(storage, key) {
    try {
        return storage.getItem(key);
    } catch {
        return null;
    }
}

function write(storage, key, value) {
    try {
        if (value == null) {
            storage.removeItem(key);
        } else {
            storage.setItem(key, value);
        }
    } catch {
        // ignore quota / private mode
    }
}

/** Stable per-browser anonymous session (llm-proxy X-Session-Id / rate limits). */
export function getOrCreateSessionId() {
    let id = read(localStorage, SESSION_KEY);
    if (!id) {
        id = randomId();
        write(localStorage, SESSION_KEY, id);
    }
    return id;
}

export function getChatId() {
    return read(sessionStorage, CHAT_KEY);
}

export function setChatId(chatId) {
    if (chatId) {
        write(sessionStorage, CHAT_KEY, String(chatId));
    }
}

/** Mint a new id without persisting (e.g. homepage hero stream). */
export function newChatId() {
    return randomId();
}

/** Start a new conversation branch id and persist it for this tab. */
export function createChatId() {
    const id = randomId();
    setChatId(id);
    return id;
}

/** Current conversation id, creating one if needed. */
export function getOrCreateChatId() {
    let id = getChatId();
    if (!id) {
        id = createChatId();
    }
    return id;
}

/** Accept chat_id from agent `done` (or first response) and persist it. */
export function rememberChatId(chatId) {
    if (typeof chatId === 'string' && chatId.trim()) {
        setChatId(chatId.trim());
        return chatId.trim();
    }
    return getChatId();
}

export function loadHistory() {
    try {
        const raw = sessionStorage.getItem(HISTORY_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed
            .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content != null)
            .map((m) => ({ role: m.role, content: String(m.content) }));
    } catch {
        return [];
    }
}

export function saveHistory(messages) {
    try {
        sessionStorage.setItem(
            HISTORY_KEY,
            JSON.stringify(
                (messages || []).map((m) => ({
                    role: m.role,
                    content: String(m.content ?? ''),
                }))
            )
        );
    } catch {
        // ignore
    }
}

/**
 * Hero → chat handoff payload.
 * Supports legacy array-of-messages format.
 * @returns {{ chat_id: string | null, session_id: string | null, messages: object[] }}
 */
export function consumeContinueSeed() {
    let raw;
    try {
        raw = sessionStorage.getItem(CONTINUE_KEY);
        sessionStorage.removeItem(CONTINUE_KEY);
    } catch {
        return { chat_id: null, session_id: null, messages: [] };
    }
    if (!raw) {
        return { chat_id: null, session_id: null, messages: [] };
    }
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return { chat_id: null, session_id: null, messages: parsed };
        }
        if (parsed && typeof parsed === 'object') {
            return {
                chat_id: typeof parsed.chat_id === 'string' ? parsed.chat_id : null,
                session_id: typeof parsed.session_id === 'string' ? parsed.session_id : null,
                messages: Array.isArray(parsed.messages) ? parsed.messages : [],
            };
        }
    } catch {
        // ignore
    }
    return { chat_id: null, session_id: null, messages: [] };
}

export function stashContinueSeed({ chatId, sessionId, messages }) {
    try {
        sessionStorage.setItem(
            CONTINUE_KEY,
            JSON.stringify({
                chat_id: chatId || null,
                session_id: sessionId || null,
                messages: messages || [],
            })
        );
    } catch {
        // ignore
    }
}
