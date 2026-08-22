// ════════════════════════════════════════════════════════════
//  puzzle.js: the reorg puzzle. Scramble the map, then put everyone back
//  where they were in the fewest moves. The compare overlay is the guide:
//  the board marks who moved, joined or left against the pre-scramble
//  document, and the Changes tab lists it. Every board mutation is a
//  move; a hint flashes one wrong seat. Undo is off while it runs (it
//  would be the answer key). Lazy-imported by events.js; works in both
//  views, and with Sim mode on the people walk as you fix it.
// ════════════════════════════════════════════════════════════

import { state, ui, snapshot, setMembership, removeMembership, membershipsOf, allGroups, resetTo } from './state.js'
import { afterChange, renderToolbar } from './render.js'
import { setCompare } from './versions.js'
import { modelToDoc, normalizeDoc } from './schema.js'
import { $, showToast } from './utils.js'

export const puzzle = { on: false, base: null, moves: 0, hints: 0, sig: '', startedAt: 0 }
const BEST_KEY = 'floorplan-puzzle-best'

const seated = () => Object.values(state.people).filter(p => membershipsOf(p.id).length)
const membershipSig = () => Object.values(state.groups).flatMap(g => g.members.map(m => `${g.id}:${m.person}:${m.pct}`)).sort().join('|')
const leftToFix = () => { const s = ui.diff?.summary; return s ? s.moves + s.joined + s.left + s.shares : 0 }

export function startPuzzle() {
  if (puzzle.on) return true
  if (ui.readonly || ui.preview) { showToast('Leave the preview or read-only view first'); return false }
  const people = seated(), rooms = allGroups().filter(g => g.kind === 'group' || g.kind === 'band')
  if (people.length < 3 || rooms.length < 2) { showToast('A puzzle needs at least three seated people in two groups'); return false }
  snapshot()                                       // one undo step returns the whole scramble once the puzzle is over
  puzzle.base = normalizeDoc(modelToDoc(state).doc).model   // a clean copy through the tree, never the live objects
  const changed = scramble(people, rooms)
  if (!changed) { showToast('Nothing to scramble here'); return false }
  puzzle.on = true; puzzle.moves = 0; puzzle.hints = 0; puzzle.startedAt = performance.now()
  ui.puzzle = true
  document.body.classList.add('puzzling')
  afterChange()                                    // save the scrambled document and regenerate the YAML panel
  setCompare({ kind: 'external', model: puzzle.base, label: 'the map before the scramble' })   // renders; the marks are the clues
  puzzle.sig = membershipSig()
  document.addEventListener('floorplan:board', onBoard)
  $('puzzleBar')?.addEventListener('click', onBarClick)
  const bar = $('puzzleBar'); if (bar) bar.hidden = false
  renderBar()
  renderToolbar()
  showToast(`Scrambled ${changed} ${changed === 1 ? 'person' : 'people'}. Put everyone back where they were`)
  return true
}

export function stopPuzzle({ restore = false } = {}) {
  if (!puzzle.on) return
  document.removeEventListener('floorplan:board', onBoard)
  $('puzzleBar')?.removeEventListener('click', onBarClick)
  puzzle.on = false; ui.puzzle = false
  document.body.classList.remove('puzzling')
  const bar = $('puzzleBar'); if (bar) bar.hidden = true
  if (restore && puzzle.base) { resetTo(normalizeDoc(modelToDoc(puzzle.base).doc).model, { keepHistory: true }); setCompare(null); afterChange() }
  else setCompare(null)
  puzzle.base = null
  renderToolbar()
}

export function togglePuzzle() { if (puzzle.on) stopPuzzle({ restore: true }); else startPuzzle() }

/** Move about 60% of the seated people to a different group (one membership each, share kept). Returns how many moved. */
function scramble(people, rooms) {
  const pool = people.slice().sort(() => Math.random() - 0.5)
  const n = Math.max(1, Math.min(pool.length, Math.round(pool.length * 0.6)))
  let moved = 0
  for (const p of pool.slice(0, n)) {
    const ms = membershipsOf(p.id); if (!ms.length) continue
    const m = ms[Math.floor(Math.random() * ms.length)]
    const here = new Set(ms.map(x => x.group.id))
    const options = rooms.filter(g => !here.has(g.id))
    if (!options.length) continue
    const to = options[Math.floor(Math.random() * options.length)]
    removeMembership(m.group.id, p.id)
    setMembership(to.id, p.id, m.pct)
    moved++
  }
  return moved
}

function onBoard() {
  if (!puzzle.on) return
  const sig = membershipSig()
  if (sig !== puzzle.sig) { puzzle.sig = sig; puzzle.moves++ }
  if (leftToFix() === 0 && ui.diff) { win(); return }
  renderBar()
}

function win() {
  const secs = Math.round((performance.now() - puzzle.startedAt) / 1000)
  const best = readBest(), key = state.meta.title || 'untitled'
  const prev = best[key]
  const record = !prev || puzzle.moves < prev.moves
  if (record) { best[key] = { moves: puzzle.moves, hints: puzzle.hints, secs, date: new Date().toISOString().slice(0, 10) }; writeBest(best) }
  const hints = puzzle.hints ? `, ${puzzle.hints} hint${puzzle.hints === 1 ? '' : 's'}` : ''
  showToast(`Solved in ${puzzle.moves} move${puzzle.moves === 1 ? '' : 's'}${hints} and ${secs}s${record ? (prev ? ', a new best' : '') : `. Best: ${prev.moves}`}`)
  const moves = puzzle.moves
  stopPuzzle()      // re-renders the board, so the confetti goes on the new layer
  celebrate()
  const status = $('puzzleStatus'); if (status) status.textContent = `Solved in ${moves} moves.`
}

/** Confetti over the building when there is one; the toast carries the result everywhere. */
function celebrate() {
  const layer = $('buildingLayer'); if (!layer) return
  const el = document.createElement('div'); el.className = 'confetti'; el.setAttribute('aria-hidden', 'true')
  const colours = ['#f472b6', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#f87171', '#fff']
  el.innerHTML = Array.from({ length: 36 }, (_, i) => `<i style="--x:${(i * 2.8 + Math.random() * 2).toFixed(1)}%;--d:${(Math.random() * 1.5).toFixed(2)}s;--t:${(2.4 + Math.random() * 1.5).toFixed(2)}s;--c:${colours[i % colours.length]}"></i>`).join('')
  layer.appendChild(el)
  setTimeout(() => el.remove(), 5000)
}

function hint() {
  const d = ui.diff; if (!d) return
  const wrong = d.moves[0]?.person || d.memberships.find(m => !m.moved)?.person
  if (!wrong) { showToast('Nothing left to fix'); return }
  puzzle.hints++
  const p = state.people[wrong]
  const target = d.moves[0] ? state.groups[d.moves[0].from]?.name : null
  const el = document.querySelector(`.seat[data-person="${wrong}"]`) || document.querySelector(`.roster-item[data-person="${wrong}"]`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
  el?.classList.add('is-flash'); setTimeout(() => el?.classList.remove('is-flash'), 1200)
  showToast(target ? `${p?.name || wrong} belongs in ${target}` : `${p?.name || wrong} is in the wrong place`)
  renderBar()
}

function onBarClick(e) {
  const b = e.target instanceof Element ? e.target.closest('[data-puzzle]') : null; if (!b) return
  if (b.dataset.puzzle === 'hint') hint()
  if (b.dataset.puzzle === 'giveup') { stopPuzzle({ restore: true }); showToast('Map restored') }
}

function renderBar() {
  const status = $('puzzleStatus'); if (!status || !puzzle.on) return
  const left = leftToFix()
  const best = readBest()[state.meta.title || 'untitled']
  status.innerHTML = `<strong>${left}</strong> ${left === 1 ? 'seat' : 'seats'} to fix · <strong>${puzzle.moves}</strong> ${puzzle.moves === 1 ? 'move' : 'moves'}${puzzle.hints ? ` · ${puzzle.hints} hint${puzzle.hints === 1 ? '' : 's'}` : ''}${best ? ` · best ${best.moves}` : ''}. The marks on the board and the Changes tab say who moved. <span class="sb-dim">Undo is off: move people back instead.</span>`
}

function readBest() { try { return JSON.parse(localStorage.getItem(BEST_KEY) || '{}') || {} } catch { return {} } }
function writeBest(v) { try { localStorage.setItem(BEST_KEY, JSON.stringify(v)) } catch { /* storage full or blocked: the toast still says it */ } }
