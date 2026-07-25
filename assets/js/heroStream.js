/**
 * Homepage hero: pick a random post-based blurb, stream it word-by-word, then show chat CTA.
 * Catalog comes from Ghost posts embedded in the hero (no live LLM on the critical path).
 */

import { getOrCreateSessionId, newChatId, stashContinueSeed } from './chat/ids';

const WORD_DELAY_MS = 48;
const LAST_SLUG_KEY = 'hero-last-blurb-slug';

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

function readLastSlug() {
    try {
        return sessionStorage.getItem(LAST_SLUG_KEY);
    } catch {
        return null;
    }
}

function writeLastSlug(slug) {
    try {
        sessionStorage.setItem(LAST_SLUG_KEY, slug);
    } catch {
        // ignore
    }
}

function firstSentence(text) {
    const cleaned = String(text || '')
        .replace(/\s+/g, ' ')
        .trim();
    if (!cleaned) {
        return '';
    }
    const match = cleaned.match(/^(.+?[.!?])(?:\s|$)/);
    const sentence = (match ? match[1] : cleaned).trim();
    return sentence.length > 160 ? `${sentence.slice(0, 157).trim()}…` : sentence;
}

function loadCatalog(root) {
    const nodes = root.querySelectorAll('[data-hero-catalog] article[data-slug]');
    return [...nodes].map((el) => ({
        slug: el.getAttribute('data-slug') || '',
        title: el.getAttribute('data-title') || '',
        excerpt: el.getAttribute('data-excerpt') || '',
        url: el.getAttribute('data-url') || '',
    }));
}

function pickPost(posts) {
    if (!posts.length) {
        return null;
    }
    const last = readLastSlug();
    const pool = posts.length > 1 ? posts.filter((p) => p.slug !== last) : posts;
    return pool[Math.floor(Math.random() * pool.length)] || posts[0];
}

function blurbFromPost(post) {
    const hook =
        firstSentence(post.excerpt) ||
        `I'm writing through “${post.title}” and documenting the process into insanity.`;

    const inner = `<span class="hero__hook-text">${escapeHtml(hook)}</span><span class="hero__hook-arrow" aria-hidden="true">→</span>`;
    const html = post.url
        ? `<a class="hero__hook" href="${escapeHtml(post.url)}">${inner}</a>`
        : `<p class="hero__hook">${inner}</p>`;

    return {
        html,
        plain: hook,
        chatSeed: `Tell me about the post “${post.title}”.`,
        slug: post.slug,
        title: post.title,
        url: post.url,
    };
}

function wrapWords(root) {
    const textRoot = root.querySelector('.hero__hook-text') || root;
    const walker = document.createTreeWalker(textRoot, NodeFilter.SHOW_TEXT);
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

function streamHtml(container, html) {
    const reduce = prefersReducedMotion();
    container.innerHTML = html;
    wrapWords(container);
    const words = [...container.querySelectorAll('.hero__word')];
    const arrow = container.querySelector('.hero__hook-arrow');

    if (reduce) {
        words.forEach((w) => w.classList.add('is-visible'));
        if (arrow) {
            arrow.classList.add('is-visible');
        }
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        let i = 0;
        function step() {
            if (i >= words.length) {
                if (arrow) {
                    arrow.classList.add('is-visible');
                }
                resolve();
                return;
            }
            words[i].classList.add('is-visible');
            i += 1;
            setTimeout(step, WORD_DELAY_MS);
        }
        step();
    });
}

function fallbackHtml(fallbackEl) {
    if (!fallbackEl) {
        return '<p class="hero__hook">I\'m trying to build a private cloud and documenting the process into insanity.</p>';
    }
    const clone = fallbackEl.cloneNode(true);
    clone.hidden = false;
    clone.removeAttribute('data-hero-fallback');
    clone.classList.remove('hero__stream-fallback');
    return clone.innerHTML;
}

export default function initHeroStream() {
    const home = document.querySelector('[data-hero-home]');
    const root = document.querySelector('[data-hero-stream]');
    if (!home || !root) {
        return;
    }

    const body = root.querySelector('[data-hero-stream-body]');
    const fallback = root.querySelector('[data-hero-fallback]');
    const continueBtn = root.querySelector('[data-hero-continue]');
    const chatUrl = home.getAttribute('data-chat-url') || '';

    if (!body) {
        return;
    }

    const posts = loadCatalog(root);
    const post = pickPost(posts);
    const blurb = post
        ? blurbFromPost(post)
        : {
              html: fallbackHtml(fallback),
              plain: fallback?.textContent?.trim() || '',
              chatSeed: 'What should I read first on this blog?',
              slug: 'fallback',
              title: '',
              url: '',
          };

    if (post) {
        writeLastSlug(post.slug);
    }

    function revealChat() {
        if (!continueBtn || !chatUrl) {
            return;
        }

        const sessionId = getOrCreateSessionId();
        const chatId = newChatId();
        stashContinueSeed({
            chatId,
            sessionId,
            messages: [
                {
                    role: 'user',
                    content: blurb.chatSeed,
                    hide: true,
                },
                {
                    role: 'assistant',
                    content: blurb.plain,
                },
            ],
        });

        continueBtn.hidden = false;
        requestAnimationFrame(() => {
            continueBtn.classList.add('is-visible');
        });
    }

    (async () => {
        await streamHtml(body, blurb.html);
        document.dispatchEvent(
            new CustomEvent('hero:stream-done', {
                detail: { slug: blurb.slug, title: blurb.title },
            })
        );
        revealChat();
    })();
}
