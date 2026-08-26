// ════════════════════════════════════════════════════════════
//  sim.js: Sim mode, the office alive. One actor per seated person walks
//  the building view: in at the start, to their desk, then off on small
//  routines (coffee, a chat, a team sync, the other desk of a split week)
//  decided by sim-brain.js, which also runs the events (party, coffee
//  break, earthquake, outage). A clock dims people outside their core
//  hours. Click an actor, then a colleague (they talk) or the floor (they
//  walk there). View-only: nothing lands in the document or the exports.
//  Lazy-imported by events.js the first time Sim is pressed; re-anchors
//  itself on every board render.
// ════════════════════════════════════════════════════════════

import { state, ui } from './state.js'
import { getLayout, renderToolbar } from './render.js'
import { passableGrid } from './layout.js'
import { $, showToast, escHtml } from './utils.js'
import { avatarSpec, spriteDataUrl, loadPixelFont } from './avatar.js'
import { zoneFor } from './timezones.js'
import { findPath, cellOf } from './path.js'
import { decide, setOut, chatWith, triggerEvent, endEvent, EVENTS, onLayer } from './sim-brain.js'

export const sim = { on: false, clock: null, playing: false, nextAdvance: 0, speed: 1, selected: null, event: null, grid: null, layout: null, anchors: new Map(), timer: null, pausedAt: 0 }
export const actors = new Map()
const TICK = 100
export const now = () => performance.now()
export const rand = (a, b) => a + Math.random() * (b - a)
export const pick = arr => arr[Math.floor(Math.random() * arr.length)]
export const dur = ms => ms / sim.speed
export const layerEl = () => $('buildingLayer')
export const cellPx = () => { const l = layerEl(); return l && sim.layout ? l.getBoundingClientRect().width / sim.layout.cols : 48 }

// ── Lifecycle ────────────────────────────────────────────────
export function startSim({ event = null } = {}) {
  if (sim.on) return true
  const layout = getLayout()
  if (!layout) { showToast('Switch to Building first'); return false }
  sim.on = true; ui.simulating = true
  document.body.classList.add('simulating')
  loadPixelFont()
  rebuild(layout)
  sim.timer = setInterval(tick, TICK)
  document.addEventListener('floorplan:board', onBoard)
  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKey)
  document.addEventListener('visibilitychange', onVisibility)
  $('simBar')?.addEventListener('click', onBarClick)
  $('simClock')?.addEventListener('input', onClockInput)
  const bar = $('simBar'); if (bar) bar.hidden = false
  renderBar()
  renderToolbar()
  showToast('Sim on. Click a character, then a colleague to make them talk, or the floor to send them there')
  if (event && EVENTS[event]) setTimeout(() => { if (sim.on) triggerEvent(event) }, dur(3500))
  return true
}

export function stopSim() {
  if (!sim.on) return
  endEvent(true)
  clearInterval(sim.timer); sim.timer = null
  document.removeEventListener('floorplan:board', onBoard)
  document.removeEventListener('click', onClick, true)
  document.removeEventListener('keydown', onKey)
  document.removeEventListener('visibilitychange', onVisibility)
  $('simBar')?.removeEventListener('click', onBarClick)
  $('simClock')?.removeEventListener('input', onClockInput)
  for (const a of actors.values()) a.el.remove()
  actors.clear(); sim.anchors.clear(); sim.selected = null; sim.on = false; ui.simulating = false
  document.body.classList.remove('simulating')
  const bar = $('simBar'); if (bar) bar.hidden = true
  renderToolbar()
}

export function toggleSim() { if (sim.on) stopSim(); else startSim() }

function onBoard() {
  if (!sim.on) return
  const layout = getLayout()
  if (!layout) { stopSim(); return }
  rebuild(layout)
}

// ── Anchors and actors ───────────────────────────────────────
function rebuild(layout) {
  sim.layout = layout
  sim.grid = passableGrid(layout)
  measureAnchors()
  const layer = layerEl(); if (!layer) return
  let i = 0
  for (const [pid, homes] of sim.anchors) {
    const p = state.people[pid]; if (!p) continue
    let a = actors.get(pid)
    if (!a) { a = spawn(p, homes, i++); continue }
    a.homes = homes; a.home = Math.min(a.home, homes.length - 1)
    setLook(a)
    layer.appendChild(a.el)
    if (a.path.length) reroute(a)
    else if (a.state === 'desk' || a.state === 'out') { const h = homes[a.home]; a.x = h.x; a.y = h.y; place(a) }
  }
  for (const [pid, a] of actors) {
    if (sim.anchors.has(pid)) continue
    if (!a.guest) { a.el.remove(); actors.delete(pid); if (sim.selected === a) select(null); continue }
    layer.appendChild(a.el)   // a guest has no desk: keep them on the new layer
    if (a.path.length) reroute(a)
  }
  onLayer(layer)
}

/** The grid may have changed under a walker: re-route to the same destination, or give up and idle. */
function reroute(a) {
  const last = a.path[a.path.length - 1], then = a.onArrive, st = a.state, run = a.stepMs < 200
  if (!walkTo(a, last, { then, state: st, run })) { a.path = []; a.walking = false; a.onArrive = null; a.state = 'idle'; a.until = now() }
}

/** An extra actor that is not one of the people (the tour visitor). Survives re-renders, removed by removeGuests(). */
export function spawnGuest(spec, name = 'Guest') {
  const el = document.createElement('div')
  el.className = 'actor is-guest'; el.dataset.actor = '__guest_' + Math.random().toString(36).slice(2, 7)
  el.setAttribute('aria-label', name)
  el.innerHTML = `<img alt="" draggable="false" width="32" height="32"><span class="actor-tag">${escHtml(name)}</span><span class="bubble" hidden></span>`
  const a = {
    id: el.dataset.actor, el, img: el.firstElementChild, bubble: el.lastElementChild, homes: [], home: 0, guest: true,
    x: 0.5, y: sim.layout.rows - 0.5, path: [], walking: false, state: 'idle', until: Infinity, nextAt: 0, stepMs: 250, frame: 0, face: 1,
    offset: null, out: false, bubbleUntil: 0, onArrive: null, spec, frames: [0, 1, 2].map(f => spriteDataUrl(spec, 1, f)), task: null, partner: null, energy: 1, social: 1, lunched: true,
  }
  a.img.src = a.frames[0]
  place(a)
  layerEl()?.appendChild(el)
  actors.set(a.id, a)
  return a
}
export function removeGuests() { for (const [id, a] of actors) if (a.guest) { a.el.remove(); actors.delete(id) } }

export function measureAnchors() {
  const layer = layerEl(); const map = new Map()
  if (!layer) { sim.anchors = map; return }
  const lr = layer.getBoundingClientRect(), cell = lr.width / sim.layout.cols
  if (!(cell > 0)) return   // layer not laid out yet: keep the previous anchors
  layer.querySelectorAll('.seat[data-person]').forEach(seat => {
    const face = seat.querySelector(':scope > .px-avatar, :scope > .face-disc') || seat
    const r = face.getBoundingClientRect()
    const x = (r.left + r.width / 2 - lr.left) / cell, y = (r.top + r.height / 2 - lr.top) / cell
    const list = map.get(seat.dataset.person) || []
    list.push({ group: seat.dataset.from, x, y, cell: { x: Math.floor(x), y: Math.floor(y) }, color: seat.style.getPropertyValue('--seat-color').trim() || '#64748b', el: seat })
    map.set(seat.dataset.person, list)
  })
  sim.anchors = map
}

function spawn(p, homes, index) {
  const el = document.createElement('div')
  el.className = 'actor'; el.dataset.actor = p.id
  el.tabIndex = 0; el.setAttribute('role', 'button'); el.setAttribute('aria-label', `${p.name}: pick, then a colleague or the floor`)
  el.innerHTML = `<img alt="" draggable="false" width="32" height="32"><span class="actor-tag">${escHtml(p.name.split(/\s+/)[0])}</span><span class="bubble" hidden></span>`
  const drop = ui.lastDrop && now() - ui.lastDrop.t < 1500 ? dropCell(ui.lastDrop) : null   // a person dropped on the floor starts where they landed
  const a = {
    id: p.id, el, img: el.firstElementChild, bubble: el.lastElementChild, homes, home: 0,
    x: drop ? drop.x : 0.5, y: drop ? drop.y : sim.layout.rows - 0.5, path: [], walking: false, state: 'arrive', until: 0, nextAt: 0, stepMs: 260, frame: 0, face: 1,
    offset: zoneFor(p)?.offset ?? null, out: false, bubbleUntil: 0, onArrive: null, spec: null, frames: [], task: null, partner: null,
    energy: rand(0.5, 1), social: rand(0.4, 1), lunched: false,
  }
  setLook(a)
  place(a)
  layerEl().appendChild(el)
  actors.set(p.id, a)
  a.until = now() + (drop ? 150 : index * 160 + 200)   // stream in one after another, or go straight to the desk
  if (drop) say(a, 'hi!', 1500)
  return a
}

function dropCell(pt) {
  const l = layerEl(); if (!l || !sim.layout) return null
  const lr = l.getBoundingClientRect(), cell = lr.width / sim.layout.cols
  const x = (pt.x - lr.left) / cell, y = (pt.y - lr.top) / cell
  if (!(cell > 0) || x < 0 || y < 0 || x >= sim.layout.cols || y >= sim.layout.rows) return null
  return { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 }
}

export function setLook(a) {
  const p = state.people[a.id]; if (!p) return
  const color = a.homes[a.home]?.color || '#64748b'
  a.spec = avatarSpec(p.name, p.avatar || null, color)
  a.frames = [0, 1, 2].map(f => spriteDataUrl(a.spec, 1, f))
  a.img.src = a.frames[a.frame] || a.frames[0]
}

export function place(a) {
  a.el.style.setProperty('--x', a.x.toFixed(3))
  a.el.style.setProperty('--y', a.y.toFixed(3))
  a.el.classList.toggle('face-left', a.face < 0)
  a.el.classList.toggle('is-away', !a.out && !atHome(a))   // the name shows over anyone not at their desk
}

/** Bring a room into view (the board scrolls, the page does not). */
export function scrollToRoom(gid) {
  const el = layerEl()?.querySelector(`.room[data-group="${gid}"]`); if (!el) return
  el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center', inline: 'center' })
}

export const homeOf = a => a.homes[a.home] || a.homes[0]
export const atHome = a => { const h = homeOf(a); return h && Math.abs(a.x - h.x) < 0.05 && Math.abs(a.y - h.y) < 0.05 }
export const currentCell = a => cellOf(a)

// ── Movement ─────────────────────────────────────────────────
/** Walk to a point in cell units (a desk anchor or a cell centre). Returns false if unreachable. */
export function walkTo(a, point, { run = false, then = null, state: nextState = 'walk' } = {}) {
  const cells = findPath(sim.grid, cellOf(a), point)
  if (cells === null) return false
  const pts = cells.map(c => ({ x: c.x + 0.5, y: c.y + 0.5 }))
  if (!pts.length || Math.abs(pts[pts.length - 1].x - point.x) > 0.01 || Math.abs(pts[pts.length - 1].y - point.y) > 0.01) pts.push({ x: point.x, y: point.y })
  a.path = pts; a.walking = true; a.stepMs = run ? 140 : 250; a.onArrive = then; a.state = nextState; a.nextAt = 0
  a.el.classList.remove('is-dancing', 'is-working')
  a.el.style.setProperty('--step', `${dur(a.stepMs)}ms`)
  return true
}

function step(a, t) {
  const p = a.path.shift()
  if (Math.abs(p.x - a.x) > 0.05) a.face = p.x < a.x ? -1 : 1
  a.x = p.x; a.y = p.y
  a.frame = a.frame === 1 ? 2 : 1
  a.img.src = a.frames[a.frame]
  place(a)
  a.nextAt = (t - a.nextAt > Math.max(dur(a.stepMs) * 8, 1500) ? t : a.nextAt) + dur(a.stepMs)   // steady cadence; catch up to 1.5s of lag, reset beyond
}

function arrived(a, t) {
  a.walking = false; a.frame = 0; a.img.src = a.frames[0]
  const cb = a.onArrive; a.onArrive = null
  if (cb) cb(a, t); else a.until = t + dur(rand(1500, 4000))
}

/** Direct command: send an actor to a point; it comes back to its routine on its own. */
export function sendTo(a, point) {
  if (a.out) { say(a, 'zz'); return }
  const ok = walkTo(a, point, { state: 'errand', then: act => { act.state = 'idle'; act.until = now() + dur(rand(4000, 9000)); say(act, 'here') } })
  if (!ok) say(a, 'no way'); else say(a, 'on it')
}

// ── Bubbles ──────────────────────────────────────────────────
export function say(a, text, ms = 2200) {
  a.bubble.textContent = text
  a.bubble.hidden = false
  a.bubbleUntil = ms === Infinity ? Infinity : now() + dur(ms)
}
export function hush(a) { a.bubble.hidden = true; a.bubbleUntil = 0 }

// ── Clock ────────────────────────────────────────────────────
export function hourUtc() {
  if (sim.clock !== null) return sim.clock
  const d = new Date(); return d.getUTCHours() + d.getUTCMinutes() / 60
}
export function inHours(a, h = hourUtc()) {
  if (a.offset === null || a.offset === undefined) return true
  const local = (((h + a.offset) % 24) + 24) % 24
  return local >= 9 && local < 17
}
/** The UTC half-hour with the most people inside their core hours. */
export function peakHour() {
  let best = 9, bestN = -1
  for (let h = 0; h < 24; h += 0.5) { const n = [...actors.values()].filter(a => !a.guest && inHours(a, h)).length; if (n > bestN) { bestN = n; best = h } }
  return best
}
let lastClockCheck = 0
function applyClock(t) {
  if (sim.playing && t >= sim.nextAdvance) {   // play the day: one half-hour per beat, round the clock
    sim.clock = ((sim.clock ?? hourUtc()) + 0.5) % 24
    sim.nextAdvance = t + dur(1400)
    lastClockCheck = 0
  }
  if (t - lastClockCheck < 1000) return
  lastClockCheck = t
  const h = hourUtc()
  for (const a of actors.values()) { if (a.guest) continue; const inh = inHours(a, h); if (inh === a.out) setOut(a, !inh) }
  renderBar()
}

// ── Tick ─────────────────────────────────────────────────────
function tick() {
  if (!sim.on || sim.pausedAt) return
  const t = now()
  for (const a of actors.values()) {
    if (a.path.length) { let n = 0; while (a.path.length && t >= a.nextAt && n++ < 24) step(a, t); continue }   // catch up after a throttled or paused tab
    if (a.walking) { if (t >= a.nextAt) arrived(a, t); continue }
    if (a.bubbleUntil && t >= a.bubbleUntil) hush(a)
    if (!a.out && t >= a.until) decide(a, t)
  }
  for (const a of actors.values()) if (a.path.length && a.bubbleUntil && t >= a.bubbleUntil) hush(a)
  if (sim.event && t >= sim.event.until) endEvent()
  applyClock(t)
}

function onVisibility() {
  const t = now()
  if (document.hidden) { sim.pausedAt = t; return }
  if (!sim.pausedAt) return
  const gap = t - sim.pausedAt; sim.pausedAt = 0
  for (const a of actors.values()) { a.until += gap; a.nextAt += gap; if (a.bubbleUntil && a.bubbleUntil !== Infinity) a.bubbleUntil += gap }
  if (sim.event) sim.event.until += gap
}

// ── Direct control: click an actor, then a colleague or the floor ─
export function select(a) {
  if (sim.selected) sim.selected.el.classList.remove('is-selected')
  sim.selected = a || null
  if (a) a.el.classList.add('is-selected')
  renderBar()
}

function onClick(e) {
  if (!sim.on) return
  const t = e.target instanceof Element ? e.target : null; if (!t) return
  const actorEl = t.closest('.actor')
  if (actorEl) {
    e.preventDefault(); e.stopPropagation()
    const a = actors.get(actorEl.dataset.actor); if (a && !a.guest) commandActor(a)
    return
  }
  const layer = t.closest('#buildingLayer')
  if (!layer || !sim.selected) return
  if (t.closest('button, a, input, [data-room-handle], .pct-bar, .pct-badge, .g-more, .visitor')) return
  const lr = layer.getBoundingClientRect(), cell = lr.width / sim.layout.cols
  const x = Math.floor((e.clientX - lr.left) / cell), y = Math.floor((e.clientY - lr.top) / cell)
  if (x < 0 || y < 0 || x >= sim.layout.cols || y >= sim.layout.rows) return
  e.preventDefault(); e.stopPropagation()
  sendTo(sim.selected, { x: x + 0.5, y: y + 0.5 })
  select(null)
}

/** First pick selects, a second pick on someone else sends the first over to talk, the same one again clears. */
function commandActor(a) {
  if (!sim.selected) select(a)
  else if (sim.selected === a) select(null)
  else { chatWith(sim.selected, a); select(null) }
}

function onKey(e) {
  const src = e.target instanceof Element ? e.target : document.body
  if (src.closest('input, textarea, select')) return
  if ((e.key === 'Enter' || e.key === ' ') && src.classList.contains('actor')) {
    e.preventDefault(); e.stopPropagation()
    const a = actors.get(src.dataset.actor); if (a) commandActor(a)
    return
  }
  if (e.key === 'Escape' && sim.selected) select(null)
}

// ── The bar under the toolbar ────────────────────────────────
function onBarClick(e) {
  const b = e.target instanceof Element ? e.target.closest('[data-sim]') : null; if (!b) return
  const what = b.dataset.sim
  if (what === 'live') { sim.clock = null; sim.playing = false; const r = $('simClock'); if (r) r.value = String(Math.round(hourUtc() * 2) / 2); lastClockCheck = 0; renderBar(); return }
  if (what === 'peak') { sim.clock = peakHour(); sim.playing = false; lastClockCheck = 0; renderBar(); return }
  if (what === 'play') { sim.playing = !sim.playing; if (sim.playing && sim.clock === null) sim.clock = Math.round(hourUtc() * 2) / 2; sim.nextAdvance = 0; lastClockCheck = 0; renderBar(); return }
  if (what === 'speed') { sim.speed = Number(b.dataset.value) || 1; for (const a of actors.values()) a.el.style.setProperty('--step', `${dur(a.stepMs)}ms`); renderBar(); return }
  if (what === 'calm') { endEvent(); return }
  if (EVENTS[what]) { triggerEvent(what); return }
}
function onClockInput(e) { sim.clock = Number(e.target.value); sim.playing = false; lastClockCheck = 0; renderBar() }

export function renderBar() {
  const bar = $('simBar'); if (!bar || !sim.on) return
  const h = hourUtc(), hh = String(Math.floor(h)).padStart(2, '0'), mm = String(Math.round((h % 1) * 60)).padStart(2, '0')
  const people = [...actors.values()].filter(a => !a.guest)
  const total = people.length, inCount = people.filter(a => !a.out).length
  const label = $('simClockLabel'); if (label) label.textContent = `${hh}:${mm} UTC · ${inCount} of ${total} in`
  const r = $('simClock'); if (r && document.activeElement !== r) r.value = String(Math.round(h * 2) / 2)
  bar.querySelector('[data-sim="live"]')?.setAttribute('aria-pressed', String(sim.clock === null))
  bar.querySelector('[data-sim="play"]')?.setAttribute('aria-pressed', String(sim.playing))
  bar.querySelectorAll('[data-sim="speed"]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.value) === sim.speed)))
  for (const k of Object.keys(EVENTS)) bar.querySelector(`[data-sim="${k}"]`)?.setAttribute('aria-pressed', String(sim.event?.name === k))
  const calm = bar.querySelector('[data-sim="calm"]'); if (calm) calm.hidden = !sim.event
  const status = $('simStatus')
  if (status) {
    if (sim.selected) status.innerHTML = `<strong>${escHtml(state.people[sim.selected.id]?.name || '')}</strong> selected: click a colleague to make them talk, the floor to send them there, <kbd>Esc</kbd> to cancel.`
    else if (sim.event) status.textContent = EVENTS[sim.event.name].status
    else if (sim.playing) status.textContent = 'Playing the day: watch the office hand over from zone to zone. Live or the slider stops it.'
    else status.textContent = 'Click a character, then a colleague (they talk) or the floor (they walk there). Scrub the clock, or Peak for the fullest hour, or Play the day.'
  }
}
