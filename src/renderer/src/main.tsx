import React from 'react'
import ReactDOM from 'react-dom/client'
import 'katex/dist/katex.min.css'
import './index.css'
import App from './App'
import { applyAccentTheme, getAccentTheme } from './lib/theme'
import { useStore } from './store/useStore'
import { LiveLectureEngine, liveEngine } from './live/liveLectureEngine'
import { devUpdateBus } from './components/UpdateBanner'

// dev-only debug hook (never in packaged builds): lets a DevTools session drive the store and the
// live-lecture engine with synthetic transcript chunks — no microphone needed to test pipelines
if (import.meta.env.DEV) {
  ;(window as unknown as { __dictly?: unknown }).__dictly = { useStore, LiveLectureEngine, liveEngine, devUpdateBus }
}

// apply the saved accent theme before first paint (avoids a color flash)
applyAccentTheme(getAccentTheme())

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />)
