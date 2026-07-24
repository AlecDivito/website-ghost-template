/**
 * Homepage hero: stream a short LLM blurb from ghost-chat-agent.
 * Falls back to the server-rendered copy if the agent errors or is slower than 1s to first token.
 */

import {
    getOrCreateSessionId,
    newChatId,
    stashContinueSeed,
} from './chat/ids';
import { streamChat } from './chat/stream';

const FIRST_TOKEN_MS = 1000;
const WORD_DELAY_MS = 45;

const PROMPT = `Write a short homepage hero blurb for this personal engineering blog. Output ONLY a small HTML fragment using <p> tags (and optional <br>, <strong>, <em>). Match this tone and length:

<p>and this is a personal development blog about</p>
<p>JavaScript.<br>Rust.</p>
<p>I'm trying to build a private cloud and documenting the process into insanity. Join me!</p>

Suggest 1–2 concrete topics grounded in this site's published posts. No markdown fences, no preamble, no closing remarks — HTML only.`;

function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Minimal allowlist sanitizer for LLM HTML. */
function sanitizeHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    template.content
        .querySelectorAll('script, iframe, object, embed, form, link, meta, style')
        .forEach((n) => n.remove());
    template.content.querySelectorAll('*').forEach((node) => {
        const tag = node.tagName.toLowerCase();
        if (!['p', 'br', 'strong', 'em', 'a', 'span', 'b', 'i'].includes(tag)) {
            node.replaceWith(...node.childNodes);
            return;
        }
        for (const attr of [...node.attributes]) {
            const name = attr.name.toLowerCase();
            const value = attr.value.trim();
            if (name.startsWith('on') || ((name === 'href' || name === 'src') && /^javascript:/i.test(value))) {
                node.removeAttribute(attr.name);
            } else if (!(tag === 'a' && (name === 'href' || name === 'rel' || name === 'target'))) {
                if (name !== 'class') {
                    node.removeAttribute(attr.name);
                }
            }
        }
        if (tag === 'a') {
            node.setAttribute('rel', 'noopener noreferrer');
            if (!node.getAttribute('target')) {
                node.setAttribute('target', '_blank');
            }
        }
    });
    return template.innerHTML;
}

/** Progressive display while tags may still be incomplete. */
function htmlToStreamMarkup(raw) {
    const text = String(raw)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trimEnd();
    return escapeHtml(text).replace(/\n/g, '<br>');
}

function wrapWords(root) {
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
            span.className = 'hero__word';
            span.textContent = part;
            frag.appendChild(span);
        }
        textNode.parentNode.replaceChild(frag, textNode);
    }
}

function createWordPlayer(container) {
    const reduce = prefersReducedMotion();
    let visibleCount = 0;
    let timer = 0;
    let cancelled = false;

    function clearTimer() {
        if (timer) {
            clearTimeout(timer);
            timer = 0;
        }
    }

    function paintMarkup(markup, { finalize = false } = {}) {
        const html = finalize ? sanitizeHtml(markup) || htmlToStreamMarkup(markup) : markup;
        container.innerHTML = html;
        // Keep description styling on bare fragments
        if (![...container.children].some((el) => el.matches('p, .hero__description'))) {
            const p = document.createElement('p');
            p.className = 'hero__description';
            p.innerHTML = container.innerHTML;
            container.replaceChildren(p);
        } else {
            container.querySelectorAll('p').forEach((p) => {
                p.classList.add('hero__description');
            });
        }
        wrapWords(container);
        const words = [...container.querySelectorAll('.hero__word')];
        const keep = Math.min(visibleCount, words.length);
        words.slice(0, keep).forEach((w) => w.classList.add('is-visible'));

        clearTimer();
        if (reduce) {
            words.forEach((w) => w.classList.add('is-visible'));
            visibleCount = words.length;
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            let i = keep;
            function step() {
                if (cancelled) {
                    resolve();
                    return;
                }
                if (i >= words.length) {
                    visibleCount = words.length;
                    resolve();
                    return;
                }
                words[i].classList.add('is-visible');
                i += 1;
                visibleCount = i;
                timer = setTimeout(step, WORD_DELAY_MS);
            }
            step();
        });
    }

    return {
        stream(raw) {
            return paintMarkup(htmlToStreamMarkup(raw));
        },
        finish(raw) {
            const looksHtml = /<[a-z][\s\S]*>/i.test(raw);
            return paintMarkup(looksHtml ? raw : htmlToStreamMarkup(raw), { finalize: looksHtml });
        },
        fromElement(el) {
            visibleCount = 0;
            container.replaceChildren();
            const clone = el.cloneNode(true);
            clone.hidden = false;
            clone.removeAttribute('data-hero-fallback');
            clone.classList.remove('hero__stream-fallback');
            container.appendChild(clone);
            wrapWords(container);
            const words = [...container.querySelectorAll('.hero__word')];
            clearTimer();
            if (reduce) {
                words.forEach((w) => w.classList.add('is-visible'));
                return Promise.resolve();
            }
            return new Promise((resolve) => {
                let i = 0;
                function step() {
                    if (cancelled || i >= words.length) {
                        resolve();
                        return;
                    }
                    words[i].classList.add('is-visible');
                    i += 1;
                    timer = setTimeout(step, WORD_DELAY_MS);
                }
                step();
            });
        },
        cancel() {
            cancelled = true;
            clearTimer();
        },
    };
}

async function streamWithFirstTokenTimeout(agentUrl, messages, onUpdate, { chatId, sessionId }) {
    const controller = new AbortController();
    let raw = '';
    let gotActivity = false;
    let resolvedChatId = chatId || null;

    const timeout = setTimeout(() => {
        if (!gotActivity) {
            controller.abort();
        }
    }, FIRST_TOKEN_MS);

    try {
        await streamChat(
            agentUrl,
            messages,
            (eventName, data) => {
                if (!gotActivity) {
                    gotActivity = true;
                    clearTimeout(timeout);
                }
                if (eventName === 'error') {
                    if (typeof data.chat_id === 'string' && data.chat_id.trim()) {
                        resolvedChatId = data.chat_id.trim();
                    }
                    throw new Error(data.message || 'Chat error');
                }
                if (eventName === 'done' && typeof data.chat_id === 'string' && data.chat_id.trim()) {
                    resolvedChatId = data.chat_id.trim();
                }
                if (eventName === 'token' && data.text) {
                    raw += data.text;
                    onUpdate(raw);
                }
            },
            { signal: controller.signal, chatId, sessionId }
        );
        return { ok: Boolean(raw.trim()), raw, chatId: resolvedChatId };
    } catch {
        return { ok: gotActivity && Boolean(raw.trim()), raw, chatId: resolvedChatId };
    } finally {
        clearTimeout(timeout);
    }
}

export default function initHeroStream() {
    const root = document.querySelector('[data-hero-stream]');
    if (!root) {
        return;
    }

    const agentUrl = (root.getAttribute('data-agent-url') || '').replace(/\/$/, '');
    const body = root.querySelector('[data-hero-stream-body]');
    const fallback = root.querySelector('[data-hero-fallback]');
    const continueBtn = root.querySelector('[data-hero-continue]');

    if (!agentUrl || !body || !fallback) {
        return;
    }

    const player = createWordPlayer(body);
    const sessionId = getOrCreateSessionId();
    // Fresh id per hero run — do not clobber an in-progress /chat/ conversation.
    const chatId = newChatId();
    const messages = [{ role: 'user', content: PROMPT }];
    let raf = 0;
    let latest = '';

    // Hold fallback aside so the body stays empty until a source wins
    const fallbackClone = fallback.cloneNode(true);
    fallback.remove();

    function paintStream() {
        raf = 0;
        player.stream(latest);
    }

    (async () => {
        const result = await streamWithFirstTokenTimeout(
            agentUrl,
            messages,
            (raw) => {
                latest = raw;
                if (!raf) {
                    raf = requestAnimationFrame(paintStream);
                }
            },
            { chatId, sessionId }
        );

        if (raf) {
            cancelAnimationFrame(raf);
            raf = 0;
        }

        if (result.ok) {
            await player.finish(result.raw);
            const plain = body.textContent?.trim() || result.raw;
            stashContinueSeed({
                chatId: result.chatId || chatId,
                sessionId,
                messages: [
                    {
                        role: 'user',
                        content: 'Suggest a short homepage intro for visitors.',
                        hide: true,
                    },
                    { role: 'assistant', content: plain },
                ],
            });
            if (continueBtn) {
                continueBtn.hidden = false;
                requestAnimationFrame(() => continueBtn.classList.add('is-visible'));
            }
            return;
        }

        // Slow / error / empty — fade in the default copy
        player.cancel();
        const fallbackPlayer = createWordPlayer(body);
        await fallbackPlayer.fromElement(fallbackClone);
    })();
}
