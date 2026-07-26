/**
 * Thin chat client for [data-chat-root]. Talks to ghost-chat-agent SSE API.
 * ChatGPT-style full-width transcript: no bubbles, buffered word fade for assistant text.
 */

import { clearStoredConversation, getOrCreateSessionId, newChatId } from './ids';
import { streamChat } from './stream';

const WORD_DELAY_MS = 28;

function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

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

function wrapWordsIn(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
    }
    for (const textNode of textNodes) {
        const value = textNode.nodeValue;
        if (!value || !value.trim()) {
            continue;
        }
        const frag = document.createDocumentFragment();
        for (const part of value.split(/(\s+)/)) {
            if (!part) {
                continue;
            }
            if (/^\s+$/.test(part)) {
                frag.appendChild(document.createTextNode(part));
                continue;
            }
            const span = document.createElement('span');
            span.className = 'chat-word';
            span.textContent = part;
            frag.appendChild(span);
        }
        textNode.parentNode.replaceChild(frag, textNode);
    }
}

/**
 * Reveals assistant markdown with a buffered word-fade (network can run ahead).
 */
function createWordReveal(bodyEl) {
    const reduce = prefersReducedMotion();
    let networkRaw = '';
    let visibleCount = 0;
    let timer = 0;
    let finished = false;

    function paint() {
        if (timer) {
            clearTimeout(timer);
            timer = 0;
        }
        const html = renderMarkdown(networkRaw);
        bodyEl.innerHTML = html || '';
        if (!html) {
            return;
        }
        wrapWordsIn(bodyEl);
        const words = [...bodyEl.querySelectorAll('.chat-word')];
        const keep = Math.min(visibleCount, words.length);
        words.slice(0, keep).forEach((w) => w.classList.add('is-visible'));
        if (reduce) {
            words.forEach((w) => w.classList.add('is-visible'));
            visibleCount = words.length;
            return;
        }
        if (visibleCount < words.length) {
            stepReveal(words);
        }
    }

    function stepReveal(words) {
        if (finished && visibleCount >= words.length) {
            timer = 0;
            return;
        }
        if (visibleCount >= words.length) {
            timer = 0;
            return;
        }
        words[visibleCount].classList.add('is-visible');
        visibleCount += 1;
        timer = setTimeout(() => {
            const next = [...bodyEl.querySelectorAll('.chat-word')];
            stepReveal(next);
        }, WORD_DELAY_MS);
    }

    return {
        get raw() {
            return networkRaw;
        },
        setRaw(text) {
            networkRaw = text;
            bodyEl.hidden = !networkRaw.trim();
            paint();
        },
        append(text) {
            networkRaw += text;
            bodyEl.hidden = !networkRaw.trim();
            paint();
        },
        async flush() {
            finished = true;
            paint();
            if (reduce) {
                return;
            }
            await new Promise((resolve) => {
                function wait() {
                    const words = [...bodyEl.querySelectorAll('.chat-word')];
                    if (visibleCount >= words.length) {
                        resolve();
                        return;
                    }
                    setTimeout(wait, WORD_DELAY_MS);
                }
                wait();
            });
        },
    };
}

function createAssistantMessage(container) {
    const row = el('div', 'chat-msg chat-msg--assistant chat-msg--pending');
    const pending = el('p', 'chat-msg__pending');
    pending.setAttribute('aria-hidden', 'true');
    pending.appendChild(el('span', 'chat-msg__pending-text', 'Thinking'));
    const tools = el('div', 'chat-msg__tools');
    tools.hidden = true;
    const body = el('div', 'chat-msg__body chat-msg__body--md');
    body.hidden = true;
    const cites = el('ul', 'chat-citations');
    cites.hidden = true;
    row.append(pending, tools, body, cites);
    container.appendChild(row);
    container.scrollTop = container.scrollHeight;

    let settled = false;
    const toolRows = new Map();
    const reveal = createWordReveal(body);

    function clearPending() {
        if (settled) {
            return;
        }
        settled = true;
        row.classList.remove('chat-msg--pending');
        pending.remove();
        if (toolRows.size) {
            tools.hidden = false;
        }
    }

    function setPendingLabel(text) {
        if (settled) {
            return;
        }
        const label = pending.querySelector('.chat-msg__pending-text');
        if (label) {
            label.textContent = String(text || 'Thinking').replace(/…\s*$/, '').trim() || 'Thinking';
        }
    }

    return {
        get raw() {
            return reveal.raw;
        },
        setPendingLabel,
        appendToken(text) {
            const chunk = String(text ?? '');
            if (!chunk) {
                return;
            }
            // Ignore whitespace-only until real content starts
            if (!reveal.raw.trim() && !chunk.trim()) {
                return;
            }
            if (!settled && chunk.trim()) {
                clearPending();
            }
            reveal.append(chunk);
            container.scrollTop = container.scrollHeight;
        },
        async flush() {
            if (!reveal.raw.trim()) {
                reveal.setRaw('');
            }
            await reveal.flush();
            if (reveal.raw.trim()) {
                clearPending();
            }
            container.scrollTop = container.scrollHeight;
        },
        upsertTool(data) {
            if (!settled) {
                // Tool activity before prose — keep thinking state
                if (!reveal.raw.trim()) {
                    reveal.setRaw('');
                }
            }
            if (data.status === 'done') {
                setPendingLabel('Thinking');
            } else {
                setPendingLabel(toolLabel(data.name));
            }
            const key = `${data.name || 'tool'}:${JSON.stringify(data.args || {})}`;
            let rowEl = toolRows.get(key);
            if (!rowEl) {
                rowEl = el('div', 'chat-tool');
                const badge = el('span', 'chat-tool__badge');
                badge.append(
                    el('span', 'chat-tool__dot'),
                    el('span', 'chat-tool__name'),
                    el('span', 'chat-tool__detail')
                );
                rowEl.append(badge);
                tools.appendChild(rowEl);
                toolRows.set(key, rowEl);
            }
            rowEl.classList.toggle('chat-tool--running', data.status !== 'done');
            rowEl.classList.toggle('chat-tool--done', data.status === 'done');
            rowEl.querySelector('.chat-tool__name').textContent = toolLabel(data.name);
            const detail = toolDetail(data);
            const detailEl = rowEl.querySelector('.chat-tool__detail');
            detailEl.textContent = detail;
            detailEl.hidden = !detail;
            tools.hidden = false;
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
    const row = el('div', 'chat-msg chat-msg--user');
    row.append(el('div', 'chat-msg__body', text));
    container.appendChild(row);
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

function isFinePointer() {
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

/**
 * Keep the composer clear of iOS Safari’s bottom chrome / keyboard.
 * Sets --vv-bottom on :root from the visualViewport overlap.
 */
function bindVisualViewportInset() {
    const vv = window.visualViewport;
    if (!vv) {
        return;
    }

    const sync = () => {
        const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        document.documentElement.style.setProperty('--vv-bottom', `${Math.round(overlap)}px`);
    };

    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    window.addEventListener('orientationchange', sync);
    sync();
}

/** Measure sticky/fixed site header so the active chat shell sits below it. */
function syncChatHeadOffset() {
    const head = document.querySelector('#gh-head');
    if (!head) {
        return;
    }
    const height = Math.ceil(head.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--chat-head-offset', `${height}px`);
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
    bindVisualViewportInset();
    syncChatHeadOffset();
    window.addEventListener('resize', syncChatHeadOffset);
    window.addEventListener('orientationchange', syncChatHeadOffset);

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
        // Kill any iOS scroll-into-view offset before locking the shell
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        syncChatHeadOffset();
        root.classList.add('chat--active');
        document.body.classList.add('chat-active');
        messagesEl.hidden = false;
        // Re-measure after class changes (header padding / sticky → fixed)
        requestAnimationFrame(() => {
            syncChatHeadOffset();
            window.scrollTo(0, 0);
        });
    }

    function adoptChatId(nextId) {
        if (typeof nextId === 'string' && nextId.trim()) {
            chatId = nextId.trim();
        }
    }

    checkReady(agentUrl, statusEl);
    // Avoid popping the mobile keyboard on load
    if (isFinePointer()) {
        input.focus();
    }

    function autosizeInput() {
        input.style.height = 'auto';
        const max = Math.round(window.innerHeight * 0.3);
        input.style.height = `${Math.min(input.scrollHeight, max)}px`;
    }

    input.addEventListener('input', autosizeInput);
    autosizeInput();

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
        autosizeInput();
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

            await assistant.flush();
            history.push({ role: 'assistant', content: assistant.raw || '' });
            statusEl.textContent = 'Ready — ask another question.';
        } catch (error) {
            await assistant.flush();
            if (!assistant.raw) {
                assistant.appendToken(
                    error instanceof Error ? error.message : 'Something went wrong.'
                );
                await assistant.flush();
            }
            statusEl.textContent = error instanceof Error ? error.message : 'Chat failed';
            statusEl.classList.add('chat-status--warn');
            history.pop();
        } finally {
            busy = false;
            if (sendBtn) {
                sendBtn.disabled = false;
            }
            // Refocusing on phones re-opens the keyboard and can scroll the
            // locked shell off-screen (blank header-only view). Desktop only.
            if (isFinePointer()) {
                input.focus();
            }
        }
    });

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            form.requestSubmit();
        }
    });
}
