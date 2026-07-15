/**
 * Thin chat client for [data-chat-root]. Talks only to the ghost-chat-agent SSE API.
 * Expects window.marked (loaded on page-chat.hbs) for assistant markdown.
 */

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
    const bubble = el('div', 'chat-msg chat-msg--assistant');
    const label = el('span', 'chat-msg__role', 'Assistant');
    const tools = el('div', 'chat-msg__tools');
    tools.hidden = true;
    const body = el('div', 'chat-msg__body chat-msg__body--md');
    body.hidden = true;
    const cites = el('ul', 'chat-citations');
    cites.hidden = true;
    bubble.append(label, tools, body, cites);
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;

    let raw = '';
    let raf = 0;
    const toolRows = new Map();

    function paintBody() {
        body.hidden = !raw;
        body.innerHTML = raw ? renderMarkdown(raw) : '';
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
        appendToken(text) {
            raw += text;
            schedulePaint();
        },
        flush() {
            if (raf) {
                cancelAnimationFrame(raf);
                raf = 0;
            }
            paintBody();
        },
        upsertTool(data) {
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
                tools.hidden = false;
                toolRows.set(key, row);
            }
            row.classList.toggle('chat-tool--running', data.status !== 'done');
            row.classList.toggle('chat-tool--done', data.status === 'done');
            row.querySelector('.chat-tool__name').textContent = toolLabel(data.name);
            row.querySelector('.chat-tool__detail').textContent = toolDetail(data);
            row.querySelector('.chat-tool__state').textContent =
                data.status === 'done' ? 'Done' : 'Running…';
            container.scrollTop = container.scrollHeight;
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

async function streamChat(agentUrl, messages, onEvent) {
    const res = await fetch(`${agentUrl}/v1/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ messages }),
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

    const history = [];
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
            await streamChat(agentUrl, history, (eventName, data) => {
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
                if (eventName === 'error') {
                    throw new Error(data.message || 'Chat error');
                }
            });

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
