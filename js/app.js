// ── Entry point ──────────────────────────────────────────────
// Wires the modules together; nothing else lives here.

import { state, ui, loadSaved, setMode } from './state.js'
import { render } from './render.js'
import { bindEvents, loadExample } from './events.js'
import { loadFromUrl } from './export.js'

// ?embed=1 hides the chrome and never writes localStorage (iframes);
// ?readonly=1 blocks edits; ?mode=diagram|building overrides the document; ?fit=1 scales the building to fit.
function readParams() {
  const q = new URLSearchParams(location.search)
  ui.embed = q.has('embed')
  ui.readonly = q.has('readonly') || q.get('embed') === 'readonly'
  ui.fit = q.has('fit') || ui.embed
  const link = document.getElementById('embedLink')
  if (link && ui.embed) {
    q.delete('embed'); q.delete('readonly'); q.delete('fit')
    link.href = location.pathname + (q.toString() ? '?' + q.toString() : '') + location.hash
    link.hidden = false
  }
  return q
}

function init() {
  const q = readParams()
  bindEvents()
  if (!loadFromUrl()) {
    const restored = ui.embed ? false : loadSaved()   // an embed shows the URL's document or the example, never the visitor's own
    if (!restored) loadExample('atlas')
  }
  const mode = q.get('mode')
  if (mode === 'diagram' || mode === 'building') setMode(mode)
  render()
  // A #d= link pasted over an open tab is a fragment change, not a load.
  window.addEventListener('hashchange', () => { if (location.hash.startsWith('#d=')) loadFromUrl() })
}

init()
