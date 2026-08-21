// ════════════════════════════════════════════════════════════
//  render-diagram.js: the default view. Top-level groups are columns in a
//  CSS grid, sub-groups nest as inner boxes, bands are strips spanning the
//  columns they cover (packed into rows, first fit). No coordinates: the
//  browser lays it out, and image-export.js measures what it drew.
// ════════════════════════════════════════════════════════════

import { state, topGroups, bands, childrenOf } from './state.js'
import { seatHtml, vacantSeatsHtml, groupHeadHtml, ownsHtml, emptyHintHtml, capacityInfo } from './parts.js'

export function renderDiagram() {
  const tops = topGroups()
  const n = Math.max(1, tops.length)
  const colIndex = new Map(tops.map((g, i) => [g.id, i]))
  const topOf = id => {
    let g = state.groups[id]
    while (g && g.parent !== null) g = state.groups[g.parent]
    return g ? colIndex.get(g.id) : undefined
  }

  // band rows: first-fit interval packing over column indices
  const rows = []   // each row: array of [s, e)
  const bandCells = bands().map(b => {
    const idx = b.spans.map(topOf).filter(i => i !== undefined)
    const s = idx.length ? Math.min(...idx) : 0
    const e = idx.length ? Math.max(...idx) + 1 : n
    let row = rows.findIndex(r => r.every(([a, z]) => e <= a || s >= z))
    if (row < 0) { rows.push([]); row = rows.length - 1 }
    rows[row].push([s, e])
    return `<div class="dg-band-cell" style="grid-column:${s + 1} / ${e + 1};grid-row:${row + 2}">${groupBox(b, 0)}</div>`
  })

  const cols = tops.map((g, i) => `<div class="dg-col" style="grid-column:${i + 1};grid-row:1">${groupBox(g, 0)}</div>`)
  return `<div class="diagram" data-svg="root"><div class="dg-grid" style="--n:${n};grid-template-columns:repeat(${n}, minmax(200px, 1fr))">${cols.join('')}${bandCells.join('')}</div></div>`
}

function groupBox(g, depth) {
  const kids = childrenOf(g.id)
  const { vacant } = capacityInfo(g)
  const members = g.members.map(m => seatHtml(g, m)).join('') + vacantSeatsHtml(g, vacant)
  const isEmpty = !g.members.length && !kids.length && !vacant
  return `<section class="gbox gbox--${g.kind} depth-${Math.min(depth, 3)}" data-drop="group" data-group="${g.id}" style="--g:${g.color}" data-svg="box" tabindex="0" aria-label="${g.kind === 'band' ? 'Shared space' : 'Group'} ${g.name}">
    ${groupHeadHtml(g)}
    ${members ? `<div class="g-members">${members}</div>` : ''}
    ${isEmpty ? emptyHintHtml(g.kind === 'band' ? 'Shared space: drop people here' : 'Drop people here') : ''}
    ${kids.length ? `<div class="g-children">${kids.map(k => groupBox(k, depth + 1)).join('')}</div>` : ''}
    ${ownsHtml(g)}
  </section>`
}
