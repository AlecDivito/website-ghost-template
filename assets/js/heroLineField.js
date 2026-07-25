/**
 * Hero line field: a grid of short vertical needles with an ocean-roll wave.
 * Pointer bends nearby needles; on leave they spring back into the wave.
 * Sized from the CSS box only (never expands to fill the hero).
 * Survives mobile→desktop resize (field is display:none under 980px).
 */

const COLS = 14;
const ROWS = 9;
const MAX_W = 480;
const MAX_H = 360;
const HIDE_MQ = '(max-width: 980px)';

function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function initHeroLineField() {
    const root = document.querySelector('[data-hero-field]');
    const canvas = document.querySelector('[data-hero-field-canvas]');
    if (!root || !canvas) {
        return null;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return null;
    }

    const reduce = prefersReducedMotion();
    const hideMq = window.matchMedia(HIDE_MQ);

    const WAVE_SPEED = 1.15;
    const WAVE_AMP = 0.55;
    const WAVE_FREQ_X = 0.55;
    const WAVE_FREQ_Y = 0.35;

    const PULL_RADIUS = 0.45;
    const PULL_STRENGTH = 1.1;
    const PULL_IN = 0.14;
    const PULL_OUT = 0.1;

    let width = 0;
    let height = 0;
    let needles = [];
    let pointer = null;
    let time = 0;
    let raf = 0;
    let last = performance.now();
    let ready = false;
    let startAttempts = 0;

    function isHidden() {
        return hideMq.matches;
    }

    function buildNeedles() {
        needles = [];
        for (let row = 0; row < ROWS; row += 1) {
            for (let col = 0; col < COLS; col += 1) {
                const u = (col + 0.5) / COLS;
                const v = (row + 0.5) / ROWS;
                needles.push({
                    u,
                    v,
                    phase: u * WAVE_FREQ_X * Math.PI * 2 + v * WAVE_FREQ_Y * Math.PI * 2,
                    pull: 0,
                });
            }
        }
    }

    function sizeCanvas() {
        // display:none → clientWidth/Height are 0; caller must wait until visible
        const cssW = Math.floor(root.clientWidth);
        const cssH = Math.floor(root.clientHeight);
        if (cssW < 80 || cssH < 60) {
            return false;
        }

        width = Math.min(cssW, MAX_W);
        height = Math.min(cssH, MAX_H);

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        if (!needles.length) {
            buildNeedles();
        }
        return true;
    }

    function markReady() {
        if (ready) {
            return;
        }
        ready = true;
        root.classList.add('is-ready');
    }

    function stop() {
        if (raf) {
            cancelAnimationFrame(raf);
            raf = 0;
        }
        pointer = null;
        ready = false;
        root.classList.remove('is-ready');
        width = 0;
        height = 0;
    }

    function start() {
        if (isHidden()) {
            stop();
            return;
        }

        startAttempts = 0;

        function tryStart() {
            if (isHidden()) {
                stop();
                return;
            }
            if (sizeCanvas()) {
                last = performance.now();
                if (!raf) {
                    raf = requestAnimationFrame(tick);
                }
                requestAnimationFrame(markReady);
                return;
            }
            // Layout may not have applied yet after display flips back on
            startAttempts += 1;
            if (startAttempts < 12) {
                requestAnimationFrame(tryStart);
            }
        }

        requestAnimationFrame(() => requestAnimationFrame(tryStart));
    }

    function pointerFromEvent(event) {
        const rect = canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) {
            return null;
        }
        return {
            x: ((event.clientX - rect.left) / rect.width) * width,
            y: ((event.clientY - rect.top) / rect.height) * height,
        };
    }

    function waveAngle(needle, t) {
        return Math.sin(t * WAVE_SPEED + needle.phase) * WAVE_AMP;
    }

    function update() {
        if (!width || !height) {
            return;
        }

        const pullR = Math.min(width, height) * PULL_RADIUS;
        const padX = width * 0.08;
        const padY = height * 0.06;
        const usableW = width - padX * 2;
        const usableH = height - padY * 2;

        for (const needle of needles) {
            let targetPull = 0;

            if (pointer && !reduce) {
                const cx = padX + needle.u * usableW;
                const cy = padY + needle.v * usableH;
                const dx = pointer.x - cx;
                const dy = pointer.y - cy;
                const dist = Math.hypot(dx, dy);
                if (dist < pullR && dist > 0.001) {
                    const influence = (1 - dist / pullR) ** 2;
                    const toward = Math.atan2(dx, -dy);
                    targetPull = toward * influence * PULL_STRENGTH;
                }
            }

            const rate = pointer ? PULL_IN : PULL_OUT;
            needle.pull += (targetPull - needle.pull) * rate;
            if (!pointer && Math.abs(needle.pull) < 0.001) {
                needle.pull = 0;
            }
        }
    }

    function draw() {
        if (!width || !height) {
            return;
        }

        const stroke =
            getComputedStyle(root).getPropertyValue('--hero-field-stroke').trim() ||
            'rgba(239, 233, 213, 0.85)';

        ctx.clearRect(0, 0, width, height);

        const padX = width * 0.08;
        const padY = height * 0.06;
        const usableW = width - padX * 2;
        const usableH = height - padY * 2;
        const half = Math.min(usableW, usableH) * 0.03;

        ctx.lineCap = 'round';
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.25;
        ctx.globalAlpha = 0.9;

        for (const needle of needles) {
            const cx = padX + needle.u * usableW;
            const cy = padY + needle.v * usableH;
            const angle = (reduce ? 0 : waveAngle(needle, time)) + needle.pull;

            ctx.beginPath();
            ctx.moveTo(cx - Math.sin(angle) * half, cy - Math.cos(angle) * half);
            ctx.lineTo(cx + Math.sin(angle) * half, cy + Math.cos(angle) * half);
            ctx.stroke();
        }

        ctx.globalAlpha = 1;
    }

    function tick(now) {
        if (isHidden()) {
            stop();
            return;
        }
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (!reduce) {
            time += dt;
        }
        update();
        draw();
        raf = requestAnimationFrame(tick);
    }

    canvas.addEventListener('pointerenter', (event) => {
        pointer = pointerFromEvent(event);
    });
    canvas.addEventListener('pointermove', (event) => {
        pointer = pointerFromEvent(event);
    });
    canvas.addEventListener('pointerleave', () => {
        pointer = null;
    });

    function onViewportChange() {
        if (isHidden()) {
            stop();
            return;
        }
        if (raf) {
            // Already running — just remeasure
            sizeCanvas();
            return;
        }
        start();
    }

    window.addEventListener('resize', onViewportChange);
    if (typeof hideMq.addEventListener === 'function') {
        hideMq.addEventListener('change', onViewportChange);
    } else if (typeof hideMq.addListener === 'function') {
        hideMq.addListener(onViewportChange);
    }

    start();

    return {
        destroy() {
            stop();
            window.removeEventListener('resize', onViewportChange);
        },
    };
}
