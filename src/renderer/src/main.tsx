import React from 'react'
import ReactDOM from 'react-dom/client'
import 'katex/dist/katex.min.css'
import './index.css'
import App from './App'
import { applyAccentTheme, getAccentTheme } from './lib/theme'

// apply the saved accent theme before first paint (avoids a color flash)
applyAccentTheme(getAccentTheme())

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />)
