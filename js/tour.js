// ════════════════════════════════════════════════════════════
//  First-visit tour: a spotlight walkthrough of the shell, shown once,
//  right after the Atlas example loads on a fresh browser. Lazy-imported
//  like visit.js and sim.js. View-only: the flag lives in its own
//  localStorage key (puzzle best-score precedent), never in the document.
// ════════════════════════════════════════════════════════════

import { ui } from './state.js'
import { $, escHtml, debounce } from './utils.js'

const SEEN_KEY = 'floorplan-tour-v1'

const STEPS = [
  { sel: '#roster', title: 'People live here',
    body: 'Add a name below, drag it onto the board. Drop it back here to unassign.' },
  { sel: '#board', title: 'The board is the map',
    body: 'Groups hold people. A group inside a group is a sub-group; a shared space spans several.' },
  { sel: '.mode-switch', title: 'Two views, one document',
    body: 'Diagram is plain nested boxes. Building is the pixel office, with Visit and Sim.' },
  { sel: '#yamlToggle', fallback: '.header-overflow-toggle', title: 'It is all YAML',
    body: 'The whole map is one YAML document: edit it, apply it, share it as a link.' },
  { sel: '#insightToggle', fallback: '.header-overflow-toggle', title: 'Insights watches',
    body: 'Over-allocation, missing skills, thin timezone overlap: the badge counts what needs a look.' },
  { sel: '#helpBtn', fallback: '.header-overflow-toggle', title: 'Help lives behind ?',
    body: 'The help card explains every feature and key. Enjoy the office.' },
]
const FALLBACK_STEP = { title: 'Menus up top',
  body: 'On a small screen, YAML, Insights and the ? help card live behind this menu.' }

let idx = -1, spot = null, card = null, reposition = null

export function tourSeen() {
  try { return localStorage.getItem(SEEN_KEY) === '1' } catch { return false }
}

function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1') } catch { /* private mode: shows again, like the doc */ }
}

/** First selector with a real box wins; header items collapsed into the
    mobile overflow menu have no rects and fall back to the menu toggle. */
function resolve(step) {
  for (const [sel, via] of [[step.sel, false], [step.fallback, true]]) {
    if (!sel) continue
    const el = document.querySelector(sel)
    if (el && el.getClientRects().length) return { el, via }
  }
  return null
}

/** Returns true when the tour actually starts, so the caller can fall back
    to a plain toast when it is gated (embed, readonly, ?sim=, already seen). */
export function startTour() {
  if (ui.embed || ui.readonly || ui.simStart !== null || tourSeen()) return false
  markSeen()               // even a mid-tour crash never nags twice
  ui.touring = true
  spot = document.createElement('div'); spot.className = 'tour-spot'
  card = document.createElement('div'); card.className = 'tour-card'
  card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'First-visit tour')
  document.body.append(spot, card)
  reposition = debounce(() => { if (idx >= 0) show(idx, { keep: true }) }, 100)
  window.addEventListener('resize', reposition)
  window.addEventListener('scroll', reposition, { passive: true })
  document.addEventListener('keydown', onKey, true)
  idx = -1
  next()
  return true
}

export function next() {
  let seen = idx >= 0 ? resolve(STEPS[idx]) : null
  for (let i = idx + 1; i < STEPS.length; i++) {
    const r = resolve(STEPS[i])
    if (!r) continue
    // Consecutive steps collapsing onto the same fallback element are one beat.
    if (r.via && seen?.via && r.el === seen.el) continue
    idx = i
    show(i)
    return
  }
  endTour()
}

function show(i, { keep = false } = {}) {
  const step = STEPS[i]
  const r = resolve(step)
  if (!r) { if (!keep) next(); return }
  r.el.scrollIntoView({ block: 'nearest' })
  const b = r.el.getBoundingClientRect()
  const pad = 8
  spot.style.left = (b.left - pad) + 'px'
  spot.style.top = (b.top - pad) + 'px'
  spot.style.width = (b.width + pad * 2) + 'px'
  spot.style.height = (b.height + pad * 2) + 'px'
  const t = r.via ? FALLBACK_STEP : step
  const last = i === STEPS.length - 1
  card.innerHTML = `<h3>${escHtml(t.title)}</h3><p>${escHtml(t.body)}</p>
    <div class="tour-row"><span class="tour-count">${i + 1} of ${STEPS.length}</span>
    <button type="button" class="btn btn--ghost btn--sm" data-action="tour-skip">Skip</button>
    <button type="button" class="btn btn--primary btn--sm" data-action="tour-next">${last ? 'Done' : 'Next'}</button></div>`
  const cw = 300, ch = card.offsetHeight || 120
  let x, y
  if (b.height > window.innerHeight * 0.6 && b.right + cw + 24 < window.innerWidth) {
    // A rail-height target gets the card beside it, not overlapping its top.
    x = b.right + pad * 2 + 8
    y = Math.max(8, Math.min(b.top + 40, window.innerHeight - ch - 8))
  } else {
    x = Math.min(Math.max(8, b.left), window.innerWidth - cw - 8)
    y = b.bottom + pad * 2 + 8
    if (y + ch > window.innerHeight - 8) y = Math.max(8, b.top - pad * 2 - ch - 8)
  }
  card.style.left = x + 'px'
  card.style.top = y + 'px'
  card.querySelector('[data-action="tour-next"]')?.focus()
}

function onKey(e) {
  if (document.querySelector('dialog[open]')) return   // native top layer owns its keys
  if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); endTour(); return }
  if ((e.key === 'Enter' || e.key === 'ArrowRight') && !e.target.closest?.('.tour-card')) {
    e.stopPropagation(); e.preventDefault(); next()
  }
}

export function endTour() {
  if (!ui.touring) return
  ui.touring = false
  idx = -1
  window.removeEventListener('resize', reposition)
  window.removeEventListener('scroll', reposition)
  document.removeEventListener('keydown', onKey, true)
  spot?.remove(); card?.remove()
  spot = card = null
}
