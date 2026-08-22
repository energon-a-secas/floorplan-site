// ════════════════════════════════════════════════════════════
//  sim-brain.js: what the actors decide to do. The idle routine (work at
//  the desk, fetch a coffee in a shared space, chat with a colleague, hold
//  a team sync, hop to the other desk of a split week), going offline
//  outside core hours, and the four events someone can stir the office
//  with: party, coffee break, earthquake, outage. sim.js owns the actors,
//  the tick and the movement; this file only chooses targets and states.
// ════════════════════════════════════════════════════════════

import { state, membershipsOf } from './state.js'
import { showToast } from './utils.js'
import { sim, actors, walkTo, say, hush, homeOf, atHome, setLook, place, rand, pick, dur, now, layerEl, renderBar } from './sim.js'
import { interiorCells, yardCells, besideCells, spreadCells, cellOf, manhattan } from './path.js'

const IDLE = ['...', 'hmm', 'ok', 'lgtm', 'brb', 'focus', 'typing']
const CHAT = ['sync?', 'lgtm', 'ship it', 'wat', 'bug!', 'ok!', '1 sec', 'nice', '...', 'same', 'pair?', 'ha']
const COFFEE = ['coffee', 'tea', 'brb', 'mate', 'snack', 'refill']
const SYNC = ['sync', 'standup', 'blocked?', 'ok', 'next', 'demo', 'ship?']
const PARTY = ['woo!', 'yay', 'cake!', 'tunes', 'party!', 'dance', 'cheers']
const QUAKE = ['!!', 'whoa', 'run!', 'hold on', 'out!']
const AFTER = ['ok?', 'phew', 'all good', 'wild']
const OUTAGE = ['5xx', 'wat', 'rollback', 'logs?', 'on it', 'paging', 'retry', 'who?']
const FIXED = ['fixed!', 'phew', 'ship', 'postmortem']

export const EVENTS = {
  party: { label: 'Party', status: 'Party! Everyone heads for the shared space. It ends on its own, or press All clear.' },
  coffee: { label: 'Coffee break', status: 'Coffee break: the whole floor heads for the shared spaces.' },
  earthquake: { label: 'Earthquake', status: 'Earthquake: everyone out to the yard until it stops shaking.' },
  outage: { label: 'Outage', status: 'Outage: the responders run to the room that owns it.' },
}

const syncs = new Map()   // group id -> until, one sync at a time per group

// ── Idle routine ─────────────────────────────────────────────
export function decide(a, t) {
  if (sim.event) { eventIdle(a, t); return }
  if (a.state === 'arrive') { goHome(a, t); return }
  if (a.state === 'chatting') { a.until = t + dur(2000); return }   // the partner ends it
  if (a.task === 'sync') { if (Math.random() < 0.4) say(a, pick(SYNC), 1600); a.until = t + dur(rand(1500, 3000)); return }
  if (['walk', 'coffee', 'sync', 'chat', 'errand', 'idle', 'party', 'panic', 'incident'].includes(a.state) && !atHome(a)) { goHome(a, t); return }
  a.state = 'desk'
  a.el.classList.add('is-working')
  const r = Math.random()
  if (r < 0.14 && goForCoffee(a, t)) return
  if (r < 0.30 && startChat(a, t)) return
  if (r < 0.36 && startSync(a, t)) return
  if (r < 0.46 && a.homes.length > 1) { hop(a, t); return }
  if (Math.random() < 0.25) say(a, pick(IDLE), 1800)
  a.until = t + dur(rand(4000, 12000))
}

function goHome(a, t = now()) {
  const h = homeOf(a); if (!h) return
  a.el.classList.remove('is-working')
  const ok = walkTo(a, h, { state: 'walk', then: act => { act.state = 'desk'; act.el.classList.add('is-working'); act.until = now() + dur(rand(3000, 10000)) } })
  if (!ok) { a.x = h.x; a.y = h.y; place(a); a.state = 'desk'; a.until = t + dur(rand(3000, 10000)) }
}

function hop(a, t) {
  a.home = (a.home + 1) % a.homes.length
  setLook(a)
  say(a, 'other desk', 1600)
  goHome(a, t)
}

function breakSpots() {
  const cells = []
  for (const [id, r] of Object.entries(sim.layout.rects)) {
    const g = state.groups[id]; if (!g) continue
    if (r.kind === 'band' || (r.kind === 'room' && /coffee|kitchen|lounge|break|cafe|pantry|social/i.test(g.name))) cells.push(...interiorCells(r))
  }
  if (cells.length) return cells
  const yard = yardCells(sim.grid)
  const mid = { x: sim.layout.cols / 2, y: sim.layout.rows / 2 }
  return yard.sort((p, q) => manhattan(p, mid) - manhattan(q, mid)).slice(0, 12)
}

function goForCoffee(a, t) {
  const spots = breakSpots(); if (!spots.length) return false
  const c = pick(spots)
  const ok = walkTo(a, { x: c.x + 0.5, y: c.y + 0.5 }, { state: 'walk', then: act => { act.state = 'coffee'; say(act, pick(COFFEE), 2400); act.until = now() + dur(rand(3000, 6000)) } })
  if (ok) a.el.classList.remove('is-working')
  return ok
}

const free = a => !a.out && !a.path.length && !a.walking && !a.task && ['desk', 'idle'].includes(a.state)
const shareGroup = (a, b) => { const ga = new Set(membershipsOf(a.id).map(m => m.group.id)); return membershipsOf(b.id).some(m => ga.has(m.group.id)) }

function startChat(a, t) {
  const others = [...actors.values()].filter(b => b !== a && free(b))
  if (!others.length) return false
  const same = others.filter(b => shareGroup(a, b))
  const b = same.length && Math.random() < 0.7 ? pick(same) : pick(others)
  return chatWith(a, b)
}

/** `a` walks over to `b` and they talk; also the click command. */
export function chatWith(a, b, { ms = rand(5000, 9000) } = {}) {
  if (!b || a === b) return false
  if (b.out) { say(a, 'zz?', 1600); return false }
  const spots = besideCells(sim.grid, cellOf(b)).sort((p, q) => manhattan(p, cellOf(a)) - manhattan(q, cellOf(a)))
  let ok = false
  for (const c of spots) { if (walkTo(a, { x: c.x + 0.5, y: c.y + 0.5 }, { state: 'walk', then: act => talk(act, b, ms) })) { ok = true; break } }
  if (!ok) { say(a, 'no way', 1600); return false }
  a.el.classList.remove('is-working')
  b.task = 'chat'; b.state = 'chatting'; b.path = []; b.walking = false; b.until = now() + dur(ms + 12000)
  b.el.classList.remove('is-working')
  return true
}

function talk(a, b, ms) {
  a.face = b.x < a.x ? -1 : 1; b.face = -a.face; place(a); place(b)
  a.state = 'chat'; a.task = 'chat'
  const lines = Math.max(2, Math.round(ms / 1800))
  for (let i = 0; i < lines; i++) setTimeout(() => { if (a.task === 'chat' && b.task === 'chat' && sim.on) say(i % 2 ? b : a, pick(CHAT), 1500) }, dur(i * 1700 + 200))
  setTimeout(() => endChat(a, b), dur(ms))
  a.until = now() + dur(ms + 500)
}

function endChat(a, b) {
  for (const x of [a, b]) { if (x.task === 'chat') { x.task = null; hush(x); x.state = 'idle'; x.until = now() + dur(rand(300, 1500)) } }
}

function startSync(a, t) {
  const gid = homeOf(a)?.group; if (!gid) return false
  const rect = sim.layout.rects[gid]; if (!rect || (rect.kind !== 'room' && rect.kind !== 'band')) return false
  if (syncs.has(gid) && syncs.get(gid) > t) return false
  const crew = [...actors.values()].filter(b => b === a || (free(b) && b.homes.some(h => h.group === gid)))
  if (crew.length < 3) return false
  const cells = interiorCells(rect); if (cells.length < crew.length) return false
  const centre = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
  const spots = spreadCells(cells, crew.length, centre)
  const ms = rand(7000, 11000)
  syncs.set(gid, t + dur(ms + 4000))
  crew.forEach((b, i) => {
    const c = spots[i]
    b.task = 'sync'; b.el.classList.remove('is-working')
    const ok = walkTo(b, { x: c.x + 0.5, y: c.y + 0.5 }, { state: 'walk', then: act => { act.state = 'sync'; if (Math.random() < 0.6) say(act, pick(SYNC), 1800); act.until = now() + dur(rand(1500, 3000)) } })
    if (!ok) { b.task = null }
  })
  setTimeout(() => { for (const b of crew) if (b.task === 'sync') { b.task = null; b.state = 'idle'; b.until = now() + dur(rand(200, 1500)) } }, dur(ms))
  return true
}

// ── Clock: offline outside core hours ────────────────────────
export function setOut(a, out) {
  a.out = out
  a.el.classList.toggle('is-out', out)
  if (!out) { hush(a); a.state = 'desk'; a.until = now() + dur(rand(1500, 5000)); say(a, 'hi', 1600); return }
  a.task = null; a.el.classList.remove('is-working', 'is-dancing', 'is-panic', 'is-responder')
  const h = homeOf(a)
  const ok = h && walkTo(a, h, { state: 'walk', then: act => { act.state = 'out'; say(act, 'zz', Infinity) } })
  if (!ok) { if (h) { a.x = h.x; a.y = h.y; place(a) } a.state = 'out'; say(a, 'zz', Infinity) }
}

// ── Events ───────────────────────────────────────────────────
let overlay = null, layerClasses = [], alarmGroup = null, shakeTimer = null
export function onLayer(layer) {
  if (overlay) layer.appendChild(overlay)
  for (const c of layerClasses) layer.classList.add(c)
  if (alarmGroup) layer.querySelector(`.room[data-group="${alarmGroup}"]`)?.classList.add('is-alarm')
}
function setLayer(classes, alarm = null) {
  const layer = layerEl()
  for (const c of layerClasses) layer?.classList.remove(c)
  if (alarmGroup) layer?.querySelector(`.room[data-group="${alarmGroup}"]`)?.classList.remove('is-alarm')
  layerClasses = classes; alarmGroup = alarm
  if (layer) onLayer(layer)
}

export function triggerEvent(name) {
  if (!EVENTS[name] || !sim.on) return
  if (sim.event) endEvent(true)
  const t = now()
  const present = [...actors.values()].filter(a => !a.out)
  for (const a of present) { a.path = []; a.walking = false; a.onArrive = null; a.task = null; a.el.classList.remove('is-working') }
  const ms = name === 'party' ? party(present, t) : name === 'coffee' ? coffeeBreak(present, t) : name === 'earthquake' ? earthquake(present, t) : outage(present, t)
  sim.event = { name, until: t + dur(ms) }
  renderBar()
}

export function endEvent(silent = false) {
  const ev = sim.event; if (!ev) return
  sim.event = null
  clearTimeout(shakeTimer); shakeTimer = null
  overlay?.remove(); overlay = null
  setLayer([])
  const t = now()
  for (const a of actors.values()) {
    a.task = null; a.el.classList.remove('is-dancing', 'is-panic', 'is-responder')
    if (a.out) continue
    a.path = []; a.walking = false; a.onArrive = null
    if (!silent && Math.random() < 0.5) say(a, pick(ev.name === 'outage' ? FIXED : ev.name === 'earthquake' ? AFTER : ['back', 'ok', 'work']), 2000)
    a.state = 'idle'; a.until = t + dur(rand(300, 2500))
  }
  if (!silent) showToast(ev.name === 'outage' ? 'Outage resolved. Everyone drifts back' : ev.name === 'earthquake' ? 'All clear. Back inside' : 'Back to work')
  renderBar()
}

function eventIdle(a, t) {
  const name = sim.event.name
  if (a.task !== name) { if (name === 'outage' && Math.random() < 0.2) say(a, '?', 1500); a.until = t + dur(rand(3000, 8000)); return }
  const pool = name === 'party' ? PARTY : name === 'coffee' ? COFFEE : name === 'earthquake' ? (shakeTimer ? QUAKE : AFTER) : OUTAGE
  if (Math.random() < (name === 'party' ? 0.55 : 0.4)) say(a, pick(pool), 1600)
  if (name === 'party' && a.el.classList.contains('is-dancing') && Math.random() < 0.4) { a.face = -a.face; place(a) }
  a.until = t + dur(rand(1200, 3000))
}

function biggest(kind) {
  let best = null
  for (const [id, r] of Object.entries(sim.layout.rects)) { if (r.kind !== kind || !state.groups[id]) continue; if (!best || r.w * r.h > best.r.w * best.r.h) best = { id, r } }
  return best
}

function party(present, t) {
  const spot = biggest('band') || biggest('room')
  const cells = spot ? interiorCells(spot.r) : yardCells(sim.grid)
  const centre = spot ? { x: spot.r.x + spot.r.w / 2, y: spot.r.y + spot.r.h / 2 } : { x: sim.layout.cols / 2, y: sim.layout.rows / 2 }
  const spots = spreadCells(cells, present.length, centre)
  present.forEach((a, i) => {
    const c = spots[i % spots.length]
    a.task = 'party'
    walkTo(a, { x: c.x + 0.5, y: c.y + 0.5 }, { state: 'walk', then: act => { act.state = 'party'; act.el.classList.add('is-dancing'); say(act, pick(PARTY), 1600); act.until = now() + dur(rand(1000, 2500)) } })
  })
  overlay = document.createElement('div'); overlay.className = 'confetti'; overlay.setAttribute('aria-hidden', 'true')
  const colours = ['#f472b6', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#f87171', '#fff']
  overlay.innerHTML = Array.from({ length: 42 }, (_, i) => `<i style="--x:${(i * 2.38 + Math.random() * 2).toFixed(1)}%;--d:${(Math.random() * 2.5).toFixed(2)}s;--t:${(2.6 + Math.random() * 2).toFixed(2)}s;--c:${colours[i % colours.length]}"></i>`).join('')
  layerEl()?.appendChild(overlay)
  showToast(spot ? `Party in ${state.groups[spot.id].name}` : 'Party in the yard')
  return 20000
}

function coffeeBreak(present, t) {
  const cells = breakSpots()
  const spots = spreadCells(cells, present.length, { x: sim.layout.cols / 2, y: sim.layout.rows / 2 })
  present.forEach((a, i) => {
    const c = spots[i % spots.length]
    a.task = 'coffee'
    walkTo(a, { x: c.x + 0.5, y: c.y + 0.5 }, { state: 'walk', then: act => { act.state = 'coffee'; say(act, pick(COFFEE), 1800); act.until = now() + dur(rand(1500, 3500)) } })
  })
  showToast('Coffee break')
  return 11000
}

function earthquake(present, t) {
  const yard = yardCells(sim.grid)
  setLayer(['is-shaking'])
  shakeTimer = setTimeout(() => { setLayer([]); shakeTimer = null }, dur(4500))
  for (const a of present) {
    say(a, pick(QUAKE), 1500)
    const here = cellOf(a)
    const target = yard.slice().sort((p, q) => manhattan(p, here) - manhattan(q, here)).find((c, i) => i < 40 && Math.random() < 0.35) || yard[0]
    if (!target) continue
    a.task = 'earthquake'
    walkTo(a, { x: target.x + 0.5, y: target.y + 0.5 }, { run: true, state: 'walk', then: act => { act.state = 'panic'; act.el.classList.add('is-panic'); act.until = now() + dur(rand(800, 2000)) } })
  }
  showToast('Earthquake! Everyone out')
  return 13000
}

function outage(present, t) {
  const rooms = Object.entries(sim.layout.rects).filter(([id, r]) => r.kind === 'room' && state.groups[id])
  if (!rooms.length) { showToast('No room to break'); return 1 }
  const owning = rooms.filter(([id]) => state.groups[id].owns.length)
  const [oid, rect] = pick(owning.length ? owning : rooms)
  const origin = state.groups[oid]
  const lineage = new Set(); for (let g = origin; g; g = g.parent ? state.groups[g.parent] : null) lineage.add(g.id)
  const bands = Object.values(state.groups).filter(g => g.kind === 'band' && (g.spans || []).some(s => lineage.has(s))).map(g => g.id)
  let responders = present.filter(a => a.homes.some(h => lineage.has(h.group) || bands.includes(h.group)))
  if (responders.length < 2) responders = [...new Set([...responders, ...present.filter(a => !responders.includes(a)).sort(() => Math.random() - 0.5).slice(0, 2)])]
  setLayer(['is-dark'], oid)
  const cells = interiorCells(rect)
  const spots = spreadCells(cells.length ? cells : yardCells(sim.grid), responders.length, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 })
  responders.forEach((a, i) => {
    const c = spots[i % spots.length]
    a.task = 'outage'; a.el.classList.add('is-responder')
    say(a, pick(['paging', 'on it', '5xx']), 1600)
    walkTo(a, { x: c.x + 0.5, y: c.y + 0.5 }, { run: true, state: 'walk', then: act => { act.state = 'incident'; say(act, pick(OUTAGE), 1600); act.until = now() + dur(rand(1000, 2500)) } })
  })
  for (const a of present) if (!responders.includes(a) && Math.random() < 0.6) say(a, pick(['wat', '?', '5xx?']), 1600)
  showToast(`Outage in ${origin.owns[0] || origin.name}: ${responders.length} responding`)
  return 18000
}
