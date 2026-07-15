// JavaScript files are compiled and minified during the build process to the assets/built folder. See available scripts in the package.json file.

// Import CSS
import '../css/index.css'

// Import JS
import menuOpen from './menuOpen'
import infiniteScroll from './infiniteScroll'
import prism from './prism'
import heroTopics from './heroTopics'
import initChat from './chat'
import * as _ from './transition'

// Call the menu and infinite scroll functions
menuOpen()
infiniteScroll()
heroTopics()
initChat()
