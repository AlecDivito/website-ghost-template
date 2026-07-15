export default function heroTopics() {
    const el = document.getElementById('hero-word-rotation')
    if (!el || !el.children[0] || !el.children[1]) return

    const raw = el.getAttribute('data-topics') || ''
    const words = raw
        .split(',')
        .map((w) => w.trim())
        .filter(Boolean)
        .map((w) => (w.endsWith('.') ? w : `${w}.`))

    if (!words.length) return

    let index = 0
    el.children[0].textContent = words[0]
    el.children[1].textContent = ''

    // Size the rotator to the longest word so layout does not jump
    const measure = document.createElement('span')
    measure.style.cssText = 'visibility:hidden;position:absolute;white-space:nowrap'
    measure.className = el.className
    document.body.appendChild(measure)
    let maxWidth = 0
    words.forEach((word) => {
        measure.textContent = word
        maxWidth = Math.max(maxWidth, measure.offsetWidth)
    })
    document.body.removeChild(measure)
    if (maxWidth) el.style.width = `${maxWidth + 4}px`

    if (words.length < 2) return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    setInterval(() => {
        const toHide = el.children[index % 2]
        const toShow = el.children[(index + 1) % 2]
        index += 1
        toShow.textContent = words[index % words.length]

        toHide.classList.add('fadeOutUp')
        toShow.classList.remove('fadeOutUp')
        toHide.classList.remove('fadeInUp')
        toShow.classList.add('fadeInUp')
    }, 3000)
}
