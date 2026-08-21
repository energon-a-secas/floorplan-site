// ════════════════════════════════════════════════════════════
//  dnd.js: drag people between roster and groups; drag rooms in the
//  building view. Pointer events (mouse + touch), an 8px threshold before a
//  drag commits so a tap still clicks, a ghost with pointer-events:none so
//  elementFromPoint() sees through it, and pointerup/pointercancel on the
//  document so a drop outside the source element still lands (the
//  cartograph-site pattern). Renderer agnostic: it only reads the
//  data-drag / data-drop / data-room-handle contract.
// ════════════════════════════════════════════════════════════

import { state, ui, snapshot, setMembership, moveMember, splitMember, removeMembership, setLayout } from './state.js'
import { afterChange, renderBoard, getLayout } from './render.js'
import { $, showToast, escHtml, initials } from './utils.js'
import { avatarDataUrl } from './avatar.js'
import { personTotals } from './allocation.js'

const THRESHOLD = 8
let drag = null

export function bindDnd() {
  document.addEventListener('pointerdown', onDown)
  document.addEventListener('pointermove', onMove)
  document.addEventListener('pointerup', onUp)
  document.addEventListener('pointercancel', cancel)
}

function onDown(e) {
  if (e.button !== 0 || drag || ui.visiting || ui.readonly || ui.preview) return
  const bar = e.target.closest('[data-pct-bar]')
  if (bar) { startPct(bar, e); return }
  const handle = e.target.closest('[data-room-handle]')
  if (handle) { startRoom(handle, e); return }
  if (e.target.closest('button, input, textarea, select, a')) return
  const el = e.target.closest('[data-drag="person"]')
  if (!el) return
  drag = { kind: 'person', el, person: el.dataset.person, from: el.dataset.from || null, startX: e.clientX, startY: e.clientY, committed: false, ghost: null, over: null }
  try { el.setPointerCapture(e.pointerId) } catch { /* not capturable: document listeners still catch the up */ }
}

function onMove(e) {
  if (!drag) return
  if (drag.kind === 'person') movePerson(e)
  else if (drag.kind === 'pct') movePct(e)
  else moveRoom(e)
}

function onUp(e) {
  if (!drag) return
  const d = drag; drag = null
  if (d.kind === 'person') {
    cleanupPerson(d)
    if (!d.committed) return            // a click: the click handler takes it
    const target = dropTargetAt(e.clientX, e.clientY)
    if (target) commitDrop(d.person, d.from, target, { split: e.altKey })
  } else if (d.kind === 'pct') {
    endPct(d, true)
  } else {
    document.body.classList.remove('dragging-room')
    if (d.committed) afterChange()
  }
}

function cancel() {
  if (!drag) return
  const d = drag; drag = null
  if (d.kind === 'person') cleanupPerson(d)
  else if (d.kind === 'pct') endPct(d, false)
  else document.body.classList.remove('dragging-room')
}

// ── Share bar (drag or click to set, 5% steps) ───────────────
function startPct(bar, e) {
  const [group, person] = bar.dataset.pctBar.split(':')
  const m = state.groups[group]?.members.find(x => x.person === person)
  if (!m) return
  e.preventDefault()
  bar.focus({ preventScroll: true })
  drag = { kind: 'pct', bar, group, person, rect: bar.getBoundingClientRect(), start: m.pct, live: m.pct }
  try { bar.setPointerCapture(e.pointerId) } catch { /* fine */ }
  document.body.classList.add('dragging-pct')
  bar.classList.add('is-dragging')
  movePct(e)
}
function movePct(e) {
  const { rect } = drag
  const raw = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 100
  const pct = Math.max(5, Math.min(100, Math.round(raw / 5) * 5))
  if (pct === drag.live) return
  drag.live = pct
  paintPct(drag.bar, drag.group, drag.person, pct)
}
/** Live preview without a re-render: the bar, its number, and the seat badge. */
function paintPct(bar, group, person, pct) {
  bar.style.setProperty('--p', pct)
  bar.setAttribute('aria-valuenow', pct); bar.setAttribute('aria-valuetext', pct + '%')
  const num = bar.querySelector('.pct-num'); if (num) num.textContent = pct + '%'
  const badge = bar.closest('.seat')?.querySelector(`.pct-badge[data-pct="${group}:${person}"]`)
  if (badge) badge.textContent = pct + '%'
}
function endPct(d, commit) {
  document.body.classList.remove('dragging-pct')
  d.bar.classList.remove('is-dragging')
  if (commit && d.live !== d.start) {
    snapshot()
    setMembership(d.group, d.person, d.live)
    afterChange()
    const p = state.people[d.person], g = state.groups[d.group]
    if (p && g) showToast(`${p.name}: ${d.live}% in ${g.name}`)
    document.querySelector(`[data-pct-bar="${d.group}:${d.person}"]`)?.focus({ preventScroll: true })
  } else if (!commit) {
    paintPct(d.bar, d.group, d.person, d.start)
  }
}

// ── People ───────────────────────────────────────────────────
function movePerson(e) {
  const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY
  if (!drag.committed) {
    if (Math.abs(dx) + Math.abs(dy) < THRESHOLD) return
    drag.committed = true
    document.body.classList.add('dragging-person')
    drag.el.classList.add('is-dragging')
    const p = state.people[drag.person]
    const ghost = document.createElement('div')
    ghost.className = 'drag-ghost'
    const color = drag.el.style.getPropertyValue('--seat-color') || '#64748b'
    ghost.innerHTML = ui.avatars && p
      ? `<img src="${avatarDataUrl(p.name, color, p.avatar || null)}" width="48" height="48" alt=""><span class="drag-ghost-hint"></span>`
      : `<span class="drag-ghost-ini" style="--face:${escHtml(color)}">${escHtml(initials(p?.name))}</span><span class="drag-ghost-hint"></span>`
    document.body.appendChild(ghost)
    drag.ghost = ghost
  }
  drag.ghost.style.left = e.clientX + 'px'
  drag.ghost.style.top = e.clientY + 'px'
  const split = e.altKey && !!drag.from
  drag.ghost.classList.toggle('is-split', split)
  drag.ghost.querySelector('.drag-ghost-hint').textContent = split ? 'split' : ''
  const target = dropTargetAt(e.clientX, e.clientY)
  if (target !== drag.over) {
    drag.over?.classList.remove('drop-target')
    drag.over = target
    target?.classList.add('drop-target')
  }
}

function cleanupPerson(d) {
  document.body.classList.remove('dragging-person')
  d.el?.classList.remove('is-dragging')
  d.ghost?.remove()
  d.over?.classList.remove('drop-target')
}

function dropTargetAt(x, y) {
  const el = document.elementFromPoint(x, y)
  return el ? el.closest('[data-drop]') : null
}

/**
 * Land a person on a drop target. Shared with the keyboard carry path.
 *   roster -> group: add at 100% (Alt: add only what is left up to 100%)
 *   group  -> group: move, pct kept (Alt: split evenly)
 *   group  -> roster: unassign
 */
export function commitDrop(personId, from, targetEl, { split = false } = {}) {
  const p = state.people[personId]; if (!p) return false
  const kind = targetEl.dataset.drop
  if (kind === 'roster') {
    if (!from) return false
    snapshot()
    removeMembership(from, personId)
    afterChange()
    showToast(`${p.name} taken out of ${state.groups[from]?.name || 'the group'}`)
    return true
  }
  const to = targetEl.dataset.group
  const g = state.groups[to]
  if (!g || from === to) return false
  if (!from) {
    if (g.members.some(m => m.person === personId)) { showToast(`${p.name} is already in ${g.name}`); return false }
    const total = personTotals().get(personId)?.total || 0
    const pct = split ? Math.max(5, 100 - total) : 100
    snapshot()
    setMembership(to, personId, pct)
    afterChange()
    showToast(`${p.name} seated in ${g.name} at ${pct}%`)
    return true
  }
  snapshot()
  const ok = split ? splitMember(from, to, personId) : moveMember(from, to, personId)
  if (!ok) return false
  afterChange()
  showToast(split ? `${p.name} split between ${state.groups[from]?.name} and ${g.name}` : `${p.name} moved to ${g.name}`)
  return true
}

// ── Rooms (building view) ────────────────────────────────────
function startRoom(handle, e) {
  const id = handle.dataset.group
  const g = state.groups[id], r = getLayout()?.rects[id]
  if (!g || !r) return
  e.preventDefault()
  const cellPx = parseFloat(getComputedStyle($('board')).getPropertyValue('--cell')) || 48
  drag = { kind: handle.dataset.roomHandle === 'resize' ? 'room-resize' : 'room-move', id, startX: e.clientX, startY: e.clientY, rect: { x: r.x, y: r.y, w: r.w, h: r.h }, cellPx, committed: false, live: null }
  try { handle.setPointerCapture(e.pointerId) } catch { /* fine */ }
}

function moveRoom(e) {
  const dxp = e.clientX - drag.startX, dyp = e.clientY - drag.startY
  if (!drag.committed) {
    if (Math.abs(dxp) + Math.abs(dyp) < THRESHOLD) return
    drag.committed = true
    snapshot()
    document.body.classList.add('dragging-room')
  }
  const dx = dxp / drag.cellPx, dy = dyp / drag.cellPx
  const live = drag.kind === 'room-move'
    ? { x: Math.max(0, Math.round(drag.rect.x + dx)), y: Math.max(0, Math.round(drag.rect.y + dy)), w: drag.rect.w, h: drag.rect.h }
    : { x: drag.rect.x, y: drag.rect.y, w: Math.max(2, Math.round(drag.rect.w + dx)), h: Math.max(2, Math.round(drag.rect.h + dy)) }
  if (JSON.stringify(live) === JSON.stringify(drag.live)) return
  drag.live = live
  setLayout(drag.id, live)
  renderBoard()   // snap preview is the real layout; the captured handle is gone but document listeners keep the drag alive
}
