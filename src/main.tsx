import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/base.css'
import './styles/library.css'
import './styles/reader.css'

const CHUNK_RELOAD_AT = 'moyue.chunkReloadAt'
let recoveringFromStaleChunk = false

const recoverFromStaleChunk = () => {
  if (recoveringFromStaleChunk) return
  try {
    const lastReload = Number(sessionStorage.getItem(CHUNK_RELOAD_AT) || 0)
    if (Date.now() - lastReload < 20_000) return
    sessionStorage.setItem(CHUNK_RELOAD_AT, String(Date.now()))
  } catch {
    /* session storage is optional */
  }
  recoveringFromStaleChunk = true
  window.location.reload()
}

// A new deployment replaces hashed chunks. If this page was opened before it,
// dynamic imports can 404; fetch the current build instead of staying broken.
window.addEventListener('vite:preloadError', event => {
  event.preventDefault()
  recoverFromStaleChunk()
})
window.addEventListener('unhandledrejection', event => {
  const message = String(event.reason instanceof Error ? event.reason.message : event.reason)
  if (/Failed to fetch dynamically imported module|Importing a module script failed/i.test(message)) {
    recoverFromStaleChunk()
  }
})

createRoot(document.getElementById('root')!).render(<App />)
