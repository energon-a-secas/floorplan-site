// ── Entry point ──────────────────────────────────────────────
// Wires the modules together; nothing else lives here.

import { loadSaved } from './state.js'
import { render } from './render.js'
import { bindEvents, loadExample } from './events.js'
import { loadFromUrl } from './export.js'

function init() {
  bindEvents()
  if (!loadFromUrl()) {
    const restored = loadSaved()
    if (!restored) loadExample('atlas')   // first visit: start on something real, not an empty floor
  }
  render()
  // A #d= link pasted over an open tab is a fragment change, not a load.
  window.addEventListener('hashchange', () => { if (location.hash.startsWith('#d=')) loadFromUrl() })
}

init()
