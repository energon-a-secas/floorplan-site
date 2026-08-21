// ════════════════════════════════════════════════════════════
//  visit.js: walk the office. A small pixel visitor you move with WASD or
//  the arrows; walls block, doors and entrances let you through, and
//  standing next to a desk shows that person's card. Lazy-imported by
//  events.js the first time Visit is pressed, so nobody who never presses
//  it pays for it. Re-mounts itself when the board re-renders.
// ════════════════════════════════════════════════════════════

import { state, ui, membershipsOf } from './state.js'
import { getLayout } from './render.js'
import { passableGrid } from './layout.js'
import { $, showToast, escHtml } from './utils.js'
import { avatarDataUrl, myCharacter, spriteDataUrl } from './avatar.js'
import { renderMarkdown } from './markdown.js'

let pos = null, grid = null, el = null, card = null, nearSeat = null
const KEYS = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0], ArrowUp: [0, -1], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowRight: [1, 0] }

export function startVisit() {
  const layout = getLayout()
  if (!layout) { showToast('Switch to Building first'); return false }
  ui.visiting = true
  document.body.classList.add('visiting')
  grid = passableGrid(layout)
  const e = layout.entrances[0]
  pos = e ? { x: e.cell, y: Math.min(layout.rows - 1, Math.floor(e.y)) } : { x: 0, y: layout.rows - 1 }
  if (grid.ownerAt(pos.x, pos.y)) pos = { x: 0, y: layout.rows - 1 }
  document.activeElement?.blur?.()
  mount()
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('floorplan:board', onBoard)
  showToast('Visit mode: walk with WASD or the arrows, Esc to leave')
  return true
}

export function stopVisit() {
  ui.visiting = false
  document.body.classList.remove('visiting')
  document.removeEventListener('keydown', onKey, true)
  document.removeEventListener('floorplan:board', onBoard)
  el?.remove(); card?.remove(); el = card = null; nearSeat = null
}

function onBoard() {
  if (!ui.visiting) return
  const layout = getLayout()
  if (!layout) { stopVisit(); return }
  grid = passableGrid(layout)
  mount()
}

function mount() {
  const layer = $('buildingLayer'); if (!layer) return
  el?.remove()
  el = document.createElement('div')
  el.className = 'visitor'
  el.setAttribute('aria-label', 'You')
  const mine = myCharacter()
  el.innerHTML = `<img src="${mine ? spriteDataUrl(mine, 1) : avatarDataUrl('visitor', '#e2e8f0')}" width="32" height="32" alt=""><span class="visitor-tag">you</span>`
  layer.appendChild(el)
  update()
}

function update() {
  if (!el) return
  el.style.setProperty('--x', pos.x)
  el.style.setProperty('--y', pos.y)
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  lookAround()
}

function onKey(e) {
  if (e.target.closest('input, textarea, select')) return
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopVisit(); import('./render.js').then(m => m.renderToolbar()); return }
  const d = KEYS[e.key] || KEYS[e.key.toLowerCase?.()]
  if (!d) return
  e.preventDefault(); e.stopPropagation()
  const nx = pos.x + d[0], ny = pos.y + d[1]
  if (!grid.canMove(pos.x, pos.y, nx, ny)) { el?.classList.remove('bump'); void el?.offsetWidth; el?.classList.add('bump'); return }
  pos = { x: nx, y: ny }
  el?.classList.toggle('face-left', d[0] < 0)
  update()
}

function lookAround() {
  const layer = $('buildingLayer'); if (!layer) return
  const lr = layer.getBoundingClientRect()
  const cell = lr.width / (getLayout()?.cols || 24)
  let best = null
  layer.querySelectorAll('.seat[data-person]').forEach(s => {
    const r = s.getBoundingClientRect()
    const cx = (r.left + r.width / 2 - lr.left) / cell, cy = (r.top + r.height / 2 - lr.top) / cell
    const dist = Math.max(Math.abs(cx - (pos.x + 0.5)), Math.abs(cy - (pos.y + 0.5)))
    if (dist <= 1.3 && (!best || dist < best.dist)) best = { s, dist, cx, cy }
  })
  if (!best) { card?.remove(); card = null; nearSeat = null; return }
  if (nearSeat === best.s && card) return
  nearSeat = best.s
  showCard(best.s, best.cx, best.cy, layer)
}

function showCard(seat, cx, cy, layer) {
  const p = state.people[seat.dataset.person]; if (!p) return
  card?.remove()
  card = document.createElement('div')
  card.className = 'visit-card'
  const shares = membershipsOf(p.id).map(m => `<span class="visit-share" style="--g:${m.group.color}">${escHtml(m.group.name)} ${m.pct}%</span>`).join('')
  card.innerHTML = `<div class="visit-card-head"><img src="${avatarDataUrl(p.name, seat.style.getPropertyValue('--seat-color') || '#64748b')}" width="48" height="48" alt=""><div><strong>${escHtml(p.name)}</strong>${p.role ? `<div class="visit-role">${escHtml(p.role)}</div>` : ''}${p.location ? `<div class="visit-loc">${escHtml(p.location)}</div>` : ''}</div></div>
    <div class="visit-shares">${shares}</div>
    ${p.notes.trim() ? `<div class="md-preview">${renderMarkdown(p.notes)}</div>` : ''}`
  card.style.setProperty('--x', cx + 0.8)
  card.style.setProperty('--y', Math.max(0, cy - 1))
  layer.appendChild(card)
}
