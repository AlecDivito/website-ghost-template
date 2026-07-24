/**
 * Thin chat client for [data-chat-root]. Talks to ghost-chat-agent SSE API
 * (which forwards X-Chat-Id / X-Session-Id to llm-proxy).
 * Expects window.marked (loaded on chat.hbs) for assistant markdown.
 *
 * Conversation UI is ephemeral: refresh clears the transcript and starts a new chat_id.
 * Ids are still sent upstream for server-side logging; nothing is restored in the UI.
 */

import { clearStoredConversation, getOrCreateSessionId, newChatId } from './ids';
import { streamChat } from './stream';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text != null) {
        node.textContent = text;
    }
    return node;
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Minimal allowlist sanitizer for LLM markdown HTML. */
function sanitizeHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content.querySelectorAll('script, iframe, object, embed, form, link, meta').forEach((n) => n.remove());
    template.content.querySelectorAll('*').forEach((node) => {
        for (const attr of [...node.attributes]) {
            const name = attr.name.toLowerCase();
            const value = attr.value.trim();
            if (name.startsWith('on') || ((name === 'href' || name === 'src') && /^javascript:/i.test(value))) {
                node.removeAttribute(attr.name);
            }
        }
    });
    return template.innerHTML;
}

function renderMarkdown(markdown) {
    const markedApi = typeof globalThis.marked !== 'undefined' ? globalThis.marked : null;
    if (!markedApi || !markdown) {
        return escapeHtml(markdown || '').replace(/\n/g, '<br>');
    }
    const parse = typeof markedApi.parse === 'function' ? markedApi.parse.bind(markedApi) : markedApi;
    try {
        return sanitizeHtml(parse(markdown, { async: false, breaks: true, gfm: true }));
    } catch {
        return escapeHtml(markdown).replace(/\n/g, '<br>');
    }
}

function toolLabel(name) {
    if (name === 'search_knowledge') {
        return 'Searching knowledge';
    }
    if (name === 'get_document') {
        return 'Reading document';
    }
    return name || 'Tool';
}

function toolDetail(data) {
    const args = data.args || {};
    if (data.name === 'search_knowledge' && args.query) {
        return `"${args.query}"`;
    }
    if (data.name === 'get_document' && args.slug) {
        return args.slug;
    }
    if (data.status === 'done' && data.preview) {
        if (data.preview.count != null) {
            return `${data.preview.count} hit${data.preview.count === 1 ? '' : 's'}`;
        }
        if (data.preview.title) {
            return data.preview.title;
        }
        if (data.preview.error) {
            return data.preview.error;
        }
    }
    return '';
}

function createAssistantMessage(container) {
    const bubble = el('div', 'chat-msg chat-msg--assistant chat-msg--pending');
    const label = el('span', 'chat-msg__role', 'Assistant');
    const pending = el('p', 'chat-msg__pending');
    pending.setAttribute('aria-hidden', 'true');
    const pendingText = el('span', 'chat-msg__pending-text', 'Thinking');
    pending.appendChild(pendingText);
    const tools = el('div', 'chat-msg__tools');
    tools.hidden = true;
    const body = el('div', 'chat-msg__body chat-msg__body--md');
    body.hidden = true;
    const cites = el('ul', 'chat-citations');
    cites.hidden = true;
    bubble.append(label, pending, tools, body, cites);
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;

    let raw = '';
    let raf = 0;
    let settled = false;
    const toolRows = new Map();

    function clearPending() {
        if (settled) {
            return;
        }
        settled = true;
        bubble.classList.remove('chat-msg--pending');
        pending.remove();
        if (toolRows.size) {
            tools.hidden = false;
        }
    }

    function setPendingLabel(text) {
        if (settled) {
            return;
        }
        const next = String(text || 'Thinking').replace(/…\s*$/, '').trim() || 'Thinking';
        pendingText.textContent = next;
    }

    function paintBody() {
        const visible = Boolean(raw.trim());
        body.hidden = !visible;
        body.innerHTML = visible ? renderMarkdown(raw) : '';
        if (visible && toolRows.size) {
            tools.hidden = false;
        }
        container.scrollTop = container.scrollHeight;
    }

    function schedulePaint() {
        if (raf) {
            return;
        }
        raf = requestAnimationFrame(() => {
            raf = 0;
            paintBody();
        });
    }

    return {
        bubble,
        get raw() {
            return raw;
        },
        setPendingLabel,
        appendToken(text) {
            raw += String(text ?? '');
            // Ignore whitespace-only chunks (models often emit "\n\n" before tool calls)
            if (!raw.trim()) {
                return;
            }
            if (!settled) {
                clearPending();
            }
            schedulePaint();
        },
        flush() {
            if (raf) {
                cancelAnimationFrame(raf);
                raf = 0;
            }
            // Drop leading whitespace-only buffers that never became real text
            if (!raw.trim()) {
                raw = '';
            }
            paintBody();
            if (raw.trim()) {
                clearPending();
            }
        },
        upsertTool(data) {
            // Any tool activity means prior whitespace/prose wasn't the reply — stay on Thinking
            if (!settled) {
                raw = '';
            }
            if (data.status === 'done') {
                setPendingLabel('Thinking');
            } else {
                setPendingLabel(toolLabel(data.name));
            }
            const key = `${data.name || 'tool'}:${JSON.stringify(data.args || {})}`;
            let row = toolRows.get(key);
            if (!row) {
                row = el('div', 'chat-tool');
                row.append(
                    el('span', 'chat-tool__name'),
                    el('span', 'chat-tool__detail'),
                    el('span', 'chat-tool__state')
                );
                tools.appendChild(row);
                toolRows.set(key, row);
            }
            row.classList.toggle('chat-tool--running', data.status !== 'done');
            row.classList.toggle('chat-tool--done', data.status === 'done');
            row.querySelector('.chat-tool__name').textContent = toolLabel(data.name);
            row.querySelector('.chat-tool__detail').textContent = toolDetail(data);
            row.querySelector('.chat-tool__state').textContent =
                data.status === 'done' ? 'Done' : 'Running…';
            if (settled) {
                tools.hidden = false;
                container.scrollTop = container.scrollHeight;
            }
        },
        setCitations(citations) {
            cites.replaceChildren();
            if (!citations?.length) {
                cites.hidden = true;
                return;
            }
            for (const cite of citations) {
                const item = el('li', 'chat-citations__item');
                const link = el('a', 'chat-citations__link', cite.title || cite.url);
                link.href = cite.url;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                item.appendChild(link);
                cites.appendChild(item);
            }
            cites.hidden = false;
            container.scrollTop = container.scrollHeight;
        },
    };
}

function appendUserMessage(container, text) {
    const bubble = el('div', 'chat-msg chat-msg--user');
    bubble.append(el('span', 'chat-msg__role', 'You'), el('div', 'chat-msg__body', text));
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
}

async function checkReady(agentUrl, statusEl) {
    try {
        const res = await fetch(`${agentUrl}/readyz`, { method: 'GET' });
        if (res.ok) {
            statusEl.textContent = 'Ready — ask about posts, projects, or experience.';
            statusEl.classList.remove('chat-status--warn');
            return true;
        }
        statusEl.textContent = 'Agent is indexing or unavailable. Try again shortly.';
        statusEl.classList.add('chat-status--warn');
        return false;
    } catch {
        statusEl.textContent = 'Cannot reach chat agent. Check chat_agent_url.';
        statusEl.classList.add('chat-status--warn');
        return false;
    }
}

export default function initChat() {
    const root = document.querySelector('[data-chat-root]');
    if (!root) {
        return;
    }

    const agentUrl = (root.getAttribute('data-agent-url') || '').replace(/\/$/, '');
    if (!agentUrl) {
        return;
    }

    const statusEl = root.querySelector('[data-chat-status]');
    const messagesEl = root.querySelector('[data-chat-messages]');
    const form = root.querySelector('[data-chat-form]');
    const input = root.querySelector('[data-chat-input]');
    const sendBtn = root.querySelector('[data-chat-send]');

    if (!statusEl || !messagesEl || !form || !input) {
        return;
    }

    clearStoredConversation();

    const sessionId = getOrCreateSessionId();
    const history = [];
    let chatId = newChatId();
    let busy = false;
    let active = false;

    function enterActiveLayout() {
        if (active) {
            return;
        }
        active = true;
        root.classList.add('chat--active');
        document.body.classList.add('chat-active');
        messagesEl.hidden = false;
    }

    function adoptChatId(nextId) {
        if (typeof nextId === 'string' && nextId.trim()) {
            chatId = nextId.trim();
        }
    }

    checkReady(agentUrl, statusEl);
    input.focus();

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (busy) {
            return;
        }

        const text = input.value.trim();
        if (!text) {
            return;
        }

        busy = true;
        if (sendBtn) {
            sendBtn.disabled = true;
        }
        input.value = '';
        statusEl.textContent = 'Thinking…';
        statusEl.classList.remove('chat-status--warn');

        enterActiveLayout();
        history.push({ role: 'user', content: text });
        appendUserMessage(messagesEl, text);
        const assistant = createAssistantMessage(messagesEl);

        try {
            await streamChat(
                agentUrl,
                history,
                (eventName, data) => {
                    if (eventName === 'token' && data.text) {
                        if (!assistant.raw) {
                            statusEl.textContent = 'Writing…';
                        }
                        assistant.appendToken(data.text);
                    }
                    if (eventName === 'tool') {
                        statusEl.textContent =
                            data.status === 'done'
                                ? 'Thinking…'
                                : `${toolLabel(data.name)}…`;
                        assistant.upsertTool(data);
                    }
                    if (eventName === 'citations' && data.citations) {
                        assistant.setCitations(data.citations);
                    }
                    if (eventName === 'done' && data.chat_id) {
                        adoptChatId(data.chat_id);
                    }
                    if (eventName === 'error') {
                        adoptChatId(data.chat_id);
                        throw new Error(data.message || 'Chat error');
                    }
                },
                { chatId, sessionId }
            );

            assistant.flush();
            history.push({ role: 'assistant', content: assistant.raw || '' });
            statusEl.textContent = 'Ready — ask another question.';
        } catch (error) {
            assistant.flush();
            if (!assistant.raw) {
                assistant.appendToken(
                    error instanceof Error ? error.message : 'Something went wrong.'
                );
                assistant.flush();
            }
            statusEl.textContent = error instanceof Error ? error.message : 'Chat failed';
            statusEl.classList.add('chat-status--warn');
            history.pop();
        } finally {
            busy = false;
            if (sendBtn) {
                sendBtn.disabled = false;
            }
            input.focus();
        }
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            form.requestSubmit();
        }
    });
}
