// JavaScript files are compiled and minified during the build process to the assets/built folder. See available scripts in the package.json file.

// Import CSS
import '../css/index.css'

// Import JS
import menuOpen from './menuOpen'
import infiniteScroll from './infiniteScroll'
import Prism from './prism'
import heroTopics from './heroTopics'
import initHeroLineField from './heroLineField'
import initHeroStream from './heroStream'
import initChat from './chat'
import * as _ from './transition'

// Expose for view-transition re-highlight (transition.js)
window.Prism = Prism

// Call the menu and infinite scroll functions
menuOpen()
infiniteScroll()
heroTopics()
initHeroLineField()
initHeroStream()
initChat()
