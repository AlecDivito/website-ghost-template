// Logic for local debuggin
var images = document.querySelectorAll('.kg-gallery-image img')
images.forEach(function (image) {
    var container = image.closest('.kg-gallery-image')
    var width = image.attributes.width.value
    var height = image.attributes.height.value
    var ratio = width / height
    container.style.flex = ratio + ' 1 0%'
})

document.addEventListener('DOMContentLoaded', function () {
    const portal = document.getElementById('ghost-portal-root')
    const newContainer = document.getElementById('root') // Change this to your target container

    if (portal && newContainer) {
        newContainer.appendChild(portal)
    }
})

// document.addEventListener('DOMContentLoaded', function () {
//     const baseURL = 'https://alecdivito.com' // Replace with your real Ghost URL

//     document.querySelectorAll('img').forEach((img) => {
//         // Fix the `src` attribute
//         if (img?.data?.dev !== 'no') {
//             if (img.hasAttribute('src')) {
//                 let updatedSrcset = img
//                     .getAttribute('src')
//                     .replace(/\/content\/images\//g, `${baseURL}/content/images/`)
//                 img.setAttribute('src', updatedSrcset)
//             }

//             // Fix the `srcset` attribute
//             if (img.hasAttribute('srcset')) {
//                 let updatedSrcset = img
//                     .getAttribute('srcset')
//                     .replace(/\/content\/images\//g, `${baseURL}/content/images/`)
//                 img.setAttribute('srcset', updatedSrcset)
//             }
//         }
//     })
// })

// Common navigation function to use across the site
function navigateWithTransition(url, currentImageElement = null) {
    // If browser doesn't support View Transitions API, navigate normally
    if (!document.startViewTransition) {
        window.location.href = url
        return
    }

    // Store the current image src to find it on the next page
    let currentImageSrc = ''
    let imageTransitionName = ''

    if (currentImageElement && currentImageElement.src) {
        currentImageSrc = currentImageElement.src
        // Extract just the filename part from the URL (handles different domains/paths)
        const srcFilename = currentImageSrc.split('/').pop().split('?')[0]
        // Create a unique transition name based on the image filename
        imageTransitionName = `image-${srcFilename.replace(/[^a-zA-Z0-9]/g, '-')}`

        // Apply the transition name to the current image
        currentImageElement.style.viewTransitionName = imageTransitionName

        // Store this information in sessionStorage to access it after navigation
        sessionStorage.setItem('lastTransitionImage', currentImageSrc)
        sessionStorage.setItem('lastTransitionName', imageTransitionName)
    }

    // Start the transition
    const transition = document.startViewTransition(async () => {
        try {
            // Fetch the new page content
            const response = await fetch(url)
            const html = await response.text()

            // Create a temporary document to parse the HTML
            const parser = new DOMParser()
            const newDocument = parser.parseFromString(html, 'text/html')

            const newJavascripts = new Set(
                Array.from(newDocument.querySelectorAll('script[src]')).map((link) => link.src),
            )
            const currentJavascripts = new Set(
                Array.from(document.querySelectorAll('script[src]')).map((link) => link.src),
            )

            newJavascripts.forEach((scriptSrc) => {
                if (!currentJavascripts.has(scriptSrc)) {
                    const newScript = document.createElement('script')
                    newScript.src = scriptSrc
                    newScript.defer = ''
                    document.head.appendChild(newScript)
                }
            })

            const newHeadLinks = new Set(
                Array.from(newDocument.querySelectorAll('link[rel="stylesheet"]')).map(
                    (link) => link.href,
                ),
            )

            const currentHrefs = new Set(
                Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(
                    (link) => link.href,
                ),
            )

            newHeadLinks.forEach((linkHref) => {
                if (!currentHrefs.has(linkHref)) {
                    const newLink = document.createElement('link')
                    newLink.rel = 'stylesheet'
                    newLink.href = linkHref
                    document.head.appendChild(newLink)
                }
            })

            const newStyleTags = Array.from(newDocument.querySelectorAll('style'))
            newStyleTags.forEach((style) => {
                const newStyle = document.createElement('style')
                newStyle.textContent = style.textContent
                document.head.appendChild(newStyle)
            })

            // Before updating DOM, check if the target page has the same image
            if (currentImageSrc) {
                const allNewImages = newDocument.querySelectorAll('img')
                let foundImage = null

                allNewImages.forEach((img) => {
                    if (img.src.includes(currentImageSrc.split('/').pop().split('?')[0])) {
                        foundImage = img
                    }
                })

                if (foundImage) {
                    foundImage.style.viewTransitionName = imageTransitionName
                }
            }

            // Update the current document with the new content
            document.body.innerHTML = newDocument.body.innerHTML
            document.title = newDocument.title

            // Update the URL
            window.history.pushState({}, '', url)

            window.scrollTo(0, 0)

            // Setup the new page after navigation
            setupPageAfterNavigation()
        } catch (error) {
            console.error('Transition failed:', error)
            window.location.href = url // Fallback to normal navigation
        }
    })

    // Clean up after the transition is complete
    transition.finished.then(() => {
        // Remove the view-transition-name from any elements that might still have it
        document.querySelectorAll('[style*="view-transition-name"]').forEach((el) => {
            el.style.viewTransitionName = ''
        })
    })
}

// Setup the page after navigation
function setupPageAfterNavigation() {
    // Check if we're on detail page (has feature image)
    const featureImage = document.querySelector('.gh-feature-image img')
    if (featureImage) {
        setupDetailPage(featureImage)
    } else {
        // Check if we're on gallery page
        const galleryImages = document.querySelectorAll('.widget--img-container img')
        if (galleryImages.length > 0) {
            setupGalleryPage()
        }
    }

    // Setup all links for transition navigation
    setupAllLinks()

    // Body was swapped — re-run syntax highlighting on the new markup
    setupPrism()
}

// Setup the detail page
function setupDetailPage(featureImage) {
    // Get the last transition image from sessionStorage
    const lastTransitionImage = sessionStorage.getItem('lastTransitionImage')
    const lastTransitionName = sessionStorage.getItem('lastTransitionName')

    // If coming from a transition and the src matches
    if (
        lastTransitionImage &&
        featureImage.src.includes(lastTransitionImage.split('/').pop().split('?')[0])
    ) {
        featureImage.style.viewTransitionName = lastTransitionName
    }

    // Handle browser back button
    window.addEventListener('popstate', (e) => {
        console.log()
        if (window.location.href.includes('#/portal')) {
            return
        }
        // Set transition name on feature image before navigating back
        featureImage.style.viewTransitionName = lastTransitionName || 'hero-image'

        document.startViewTransition(async () => {
            try {
                // Get the previous page
                const response = await fetch(window.location.href)
                const html = await response.text()

                const parser = new DOMParser()
                const newDocument = parser.parseFromString(html, 'text/html')

                document.body.innerHTML = newDocument.body.innerHTML
                document.title = newDocument.title

                window.scrollTo(0, 0)

                // Setup the new page after back navigation
                setupPageAfterNavigation()
            } catch (error) {
                console.error('Back transition failed:', error)
            }
        })
    })
}

// Setup the gallery page
function setupGalleryPage() {
    // Get the last transition image from sessionStorage
    const lastTransitionImage = sessionStorage.getItem('lastTransitionImage')
    const lastTransitionName = sessionStorage.getItem('lastTransitionName')

    if (lastTransitionImage && lastTransitionName) {
        // Find matching image in the gallery
        const galleryImages = document.querySelectorAll('.widget--img-container img')
        galleryImages.forEach((img) => {
            if (img.src.includes(lastTransitionImage.split('/').pop().split('?')[0])) {
                img.style.viewTransitionName = lastTransitionName
            }
        })
    }

    // Handle browser back button
    window.addEventListener('popstate', () => {
        if (window.location.href.includes('#/portal')) {
            return
        }
        document.startViewTransition(async () => {
            try {
                // Get the current URL after back button is pressed
                const response = await fetch(window.location.href)
                const html = await response.text()

                const parser = new DOMParser()
                const newDocument = parser.parseFromString(html, 'text/html')

                document.body.innerHTML = newDocument.body.innerHTML
                document.title = newDocument.title

                // Setup the new page after back navigation
                setupPageAfterNavigation()
            } catch (error) {
                console.error('Back transition failed:', error)
            }
        })
    })
}

// Setup click handlers on all links
function setupAllLinks() {
    // Setup gallery article clicks
    document.querySelectorAll('article.widget').forEach((article) => {
        const img = article.querySelector('.widget--img-container img')
        const link = article.querySelector('.widget--img-container a')?.href

        if (link && img) {
            article.addEventListener('click', (e) => {
                e.preventDefault()
                navigateWithTransition(link, img)
            })
        }
    })

    // Setup other internal links (optional)
    document
        .querySelectorAll('a:not([href^="http"]):not([href^="#"]):not([role="button"])')
        .forEach((link) => {
            if (!link.closest('article.widget')) {
                // Avoid double-binding articles
                link.addEventListener('click', (e) => {
                    e.preventDefault()
                    const featureImage = document.querySelector('.gh-feature-image img')
                    if (featureImage) {
                        navigateWithTransition(link.href, featureImage)
                    } else {
                        navigateWithTransition(link.href)
                    }
                })
            }
        })
}

function setupPrism() {
    const run = () => {
        const Prism = window.Prism
        if (!Prism || typeof Prism.highlightAll !== 'function') return false
        Prism.highlightAll()
        return true
    }

    if (run()) return

    let tries = 0
    const id = setInterval(() => {
        tries += 1
        if (run() || tries > 40) clearInterval(id)
    }, 50)
}

// Initialize when the page loads
document.addEventListener('DOMContentLoaded', () => {
    setupPageAfterNavigation()
})
