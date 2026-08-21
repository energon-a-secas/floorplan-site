// ════════════════════════════════════════════════════════════
//  render-building.js: the office. Every rect from layout.js becomes an
//  absolutely positioned element on one .building-layer, sized in cells via
//  CSS custom properties (--x --y --w --h against --cell). Sub-rooms are
//  siblings, not children, so elementFromPoint() picks the deepest room and
//  z-index follows depth. Doors sit on walls, corridors live in one SVG
//  overlay, and a person split across two touching rooms gets a single seat
//  on the shared wall.
// ════════════════════════════════════════════════════════════

import { state, ui, childrenOf } from './state.js'
import { computeLayout } from './layout.js'
import { escHtml } from './utils.js'
import { seatHtml, vacantSeatsHtml, ghostSeatsHtml, groupHeadHtml, faceHtml, capacityInfo, pctBarHtml } from './parts.js'
import { totals } from './parts.js'

export function renderBuilding() {
  const layout = computeLayout()
  const { rects, doors, corridors, entrances, straddles, cols, rows } = layout
  const straddled = new Set()
  for (const s of straddles) { straddled.add(`${s.a}:${s.person}`); straddled.add(`${s.b}:${s.person}`) }

  const parts = []
  parts.push(`<div class="building" data-svg="root" style="--cols:${cols};--rows:${rows}"><div class="building-layer" id="buildingLayer" style="width:calc(${cols} * var(--cell));height:calc(${rows} * var(--cell))">`)
  parts.push(`<div class="floor-grid" aria-hidden="true"></div>`)

  // rooms, subs, bands, titles (draw order: depth)
  const ordered = Object.entries(rects).sort((a, b) => a[1].depth - b[1].depth)
  for (const [id, r] of ordered) parts.push(roomHtml(state.groups[id], r, straddled))

  // corridors (SVG overlay in cell units; strokes do not scale)
  if (corridors.length) {
    parts.push(`<svg class="corridors" viewBox="0 0 ${cols} ${rows}" preserveAspectRatio="none" aria-hidden="true">`)
    for (const c of corridors) {
      const d = c.points.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ')
      parts.push(`<path d="${d}" class="corridor-path" vector-effect="non-scaling-stroke"/>`)
      if (c.label) {
        const mid = c.points[Math.floor(c.points.length / 2) - 1], nxt = c.points[Math.floor(c.points.length / 2)]
        const mx = (mid[0] + nxt[0]) / 2, my = (mid[1] + nxt[1]) / 2
        parts.push(`<text x="${mx}" y="${my - 0.15}" class="corridor-label" text-anchor="middle" font-size="0.32">${escHtml(c.label)}</text>`)
      }
    }
    parts.push('</svg>')
  }

  // doors and entrances
  for (const d of doors) parts.push(`<div class="door door--${d.orient}" style="--x:${d.x};--y:${d.y}" title="${escHtml(d.label || 'door')}" data-svg="door"></div>`)
  for (const e of entrances) parts.push(`<div class="door door--h door--entrance" style="--x:${e.x};--y:${e.y}" data-svg="door"></div>`)

  // straddle seats
  for (const s of straddles) parts.push(straddleHtml(s))

  parts.push('</div></div>')
  return { html: parts.join(''), layout }
}

function roomHtml(g, r, straddled) {
  if (!g) return ''
  const vars = `--x:${r.x};--y:${r.y};--w:${r.w};--h:${r.h};--g:${g.color}`
  if (r.kind === 'title') {
    return `<div class="room room--title" data-drop="group" data-group="${g.id}" style="${vars}" data-svg="box" tabindex="0" aria-label="Group ${escHtml(g.name)}"><span class="room-title-text" data-svg="text">${escHtml(g.name)}</span><button type="button" class="g-more g-more--title" data-action="select-group" data-id="${g.id}" aria-label="Group details: ${escHtml(g.name)}">···</button></div>`
  }
  const kids = childrenOf(g.id)
  const { vacant } = capacityInfo(g)
  const ownSeats = g.members.filter(m => !straddled.has(`${g.id}:${m.person}`)).map(m => seatHtml(g, m, { compact: true })).join('')
    + ghostSeatsHtml(g, { compact: true })
    + vacantSeatsHtml(g, vacant, { compact: true })
  const isRoom = r.kind === 'room' || r.kind === 'band'
  const narrow = r.w < 2.5
  const gmark = ui.marks?.groups.get(g.id)
  const classes = ['room', `room--${r.kind}`, `depth-${Math.min(r.depth, 3)}`, g.kind === 'band' ? 'room--shared' : '', kids.length ? 'has-subs' : '', narrow ? 'room--narrow' : '', g.owns.length && r.kind === 'room' ? 'has-plaque' : '', gmark ? 'diff-' + gmark : ''].filter(Boolean).join(' ')
  const head = groupHeadHtml(g, { showStats: !narrow && r.w >= 6, extra: isRoom ? `<span class="room-grip" data-room-handle="move" data-group="${g.id}" title="Drag to move the room" aria-hidden="true"></span>` : '' })
  const empty = !ownSeats && !kids.length
  return `<section class="${classes}" data-drop="group" data-group="${g.id}" style="${vars};z-index:${1 + r.depth}" data-svg="box" tabindex="0" aria-label="${g.kind === 'band' ? 'Shared space' : 'Room'} ${escHtml(g.name)}">
    ${head}
    ${ownSeats ? `<div class="room-members${kids.length ? ' room-members--strip' : ''}">${ownSeats}</div>` : ''}
    ${empty ? `<div class="g-empty">${g.kind === 'band' ? 'Shared space' : 'Empty room'}</div>` : ''}
    ${g.owns.length && r.kind === 'room' ? `<div class="room-plaque" data-svg="owns">${g.owns.map(o => `<span class="own-tag" data-svg="tag">${escHtml(o)}</span>`).join('')}</div>` : ''}
    ${isRoom ? `<span class="room-resize" data-room-handle="resize" data-group="${g.id}" title="Drag to resize" aria-hidden="true"></span>` : ''}
  </section>`
}

function straddleHtml(s) {
  const p = state.people[s.person]; if (!p) return ''
  const ga = state.groups[s.a], gb = state.groups[s.b]
  const ma = ga.members.find(m => m.person === p.id), mb = gb.members.find(m => m.person === p.id)
  const t = totals().get(p.id)
  const sel = ui.selection?.type === 'person' && ui.selection.id === p.id
  const picked = ui.picked?.person === p.id
  const label = `${p.name}, ${ma.pct}% in ${ga.name} and ${mb.pct}% in ${gb.name}. Enter to pick up.`
  return `<div class="straddle" style="--x:${s.x};--y:${s.y}">
    <div class="seat seat--compact seat--straddle${sel ? ' is-selected' : ''}${picked ? ' is-picked' : ''}" data-seat="${ga.id}:${p.id}" data-drag="person" data-person="${p.id}" data-from="${ga.id}" data-straddle="${gb.id}" data-band="${t.total > 100 ? 'over' : t.total < 100 ? 'under' : 'ok'}" tabindex="0" role="button" aria-label="${escHtml(label)}" style="--seat-color:${ga.color};--seat-color-b:${gb.color}" data-svg="box">
      ${faceHtml(p, ga.color)}
      <span class="seat-meta"><span class="seat-name" data-svg="text">${escHtml(p.name)}</span></span>
      <span class="pct-pair"><button type="button" class="pct-badge" data-pct="${ga.id}:${p.id}" title="Share in ${escHtml(ga.name)}" data-svg="badge">${ma.pct}%</button><button type="button" class="pct-badge" data-pct="${gb.id}:${p.id}" title="Share in ${escHtml(gb.name)}" data-svg="badge">${mb.pct}%</button></span>
      <span class="pct-bars">${pctBarHtml(ga, p, ma.pct, t.total > 100 ? 'over' : 'ok', 'pct-bar--a')}${pctBarHtml(gb, p, mb.pct, t.total > 100 ? 'over' : 'ok', 'pct-bar--b')}</span>
    </div>
  </div>`
}
