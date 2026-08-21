// ════════════════════════════════════════════════════════════
//  parts.js: markup shared by both renderers. Seats, group headers, pct
//  badges, vacant desks. Every interactive element carries the DnD contract
//  attributes (data-drag / data-seat / data-drop) so dnd.js stays renderer
//  agnostic, and data-svg roles so image-export.js can trace the DOM.
// ════════════════════════════════════════════════════════════

import { state, ui } from './state.js'
import { escHtml, initials } from './utils.js'
import { avatarImg, vacantImg } from './avatar.js'
import { personTotals, bandOf, groupStats, statsLabel } from './allocation.js'

let totalsCache = null
export function beginFrame() { totalsCache = personTotals() }
export function totals() { return totalsCache || (totalsCache = personTotals()) }

export function faceHtml(person, color, { px = 36, forceInitials = false } = {}) {
  if (ui.avatars && !forceInitials) return avatarImg(person.name, color, { px })
  return `<span class="face-disc" style="--face:${escHtml(color || '#64748b')};width:${px}px;height:${px}px" data-svg="disc">${escHtml(initials(person.name))}</span>`
}

/** One seated person inside a group. */
export function seatHtml(group, m, { compact = false } = {}) {
  const p = state.people[m.person]; if (!p) return ''
  const t = totals().get(p.id)
  const band = bandOf(t)
  const multi = t && t.count > 1
  const showPct = m.pct !== 100 || multi
  const picked = ui.picked?.person === p.id && ui.picked?.from === group.id
  const sel = ui.selection?.type === 'person' && ui.selection.id === p.id
  const label = `${p.name}${p.location ? ', ' + p.location : ''}, ${m.pct}% in ${group.name}${multi ? `, ${t.total}% in total` : ''}. Enter to pick up, Delete to remove.`
  return `<div class="seat${compact ? ' seat--compact' : ''}${picked ? ' is-picked' : ''}${sel ? ' is-selected' : ''}" data-seat="${group.id}:${p.id}" data-drag="person" data-person="${p.id}" data-from="${group.id}" data-band="${band}" tabindex="0" role="button" aria-label="${escHtml(label)}" style="--seat-color:${escHtml(group.color)}" data-svg="box">
    ${faceHtml(p, group.color)}
    <span class="seat-meta"><span class="seat-name" data-svg="text">${escHtml(p.name)}</span>${p.location ? `<span class="seat-loc" data-svg="text">${escHtml(p.location)}</span>` : ''}</span>
    ${showPct ? `<button type="button" class="pct-badge" data-pct="${group.id}:${p.id}" data-band="${band}" title="Edit share" aria-label="Share ${m.pct}%, click to edit" data-svg="badge">${m.pct}%</button>` : ''}
  </div>`
}

export function vacantSeatsHtml(group, n, { compact = false } = {}) {
  if (n <= 0) return ''
  let out = ''
  for (let i = 0; i < Math.min(n, 4); i++) out += `<div class="seat seat--vacant${compact ? ' seat--compact' : ''}" title="Open seat" aria-hidden="true">${vacantImg(36)}<span class="seat-meta"><span class="seat-name">open</span></span></div>`
  if (n > 4) out += `<div class="seat seat--vacant seat--more${compact ? ' seat--compact' : ''}" aria-hidden="true"><span class="seat-meta"><span class="seat-name">+${n - 4} open</span></span></div>`
  return out
}

export function groupHeadHtml(group, { tag = 'header', showStats = true, extra = '' } = {}) {
  const sel = ui.selection?.type === 'group' && ui.selection.id === group.id
  return `<${tag} class="g-head${sel ? ' is-selected' : ''}" data-group-head="${group.id}">
    <span class="g-name" data-svg="text">${escHtml(group.name)}</span>
    ${showStats ? `<span class="g-stats" data-svg="text">${escHtml(statsLabel(group.id))}</span>` : ''}
    ${group.notes ? `<span class="g-note-dot" title="Has notes" aria-label="Has notes" data-action="select-group" data-id="${group.id}"></span>` : ''}
    ${extra}
    <button type="button" class="g-more" data-action="select-group" data-id="${group.id}" aria-label="Group details: ${escHtml(group.name)}">···</button>
  </${tag}>`
}

export function ownsHtml(group) {
  if (!group.owns.length) return ''
  return `<div class="g-owns" data-svg="owns">${group.owns.map(o => `<span class="own-tag" data-svg="tag">${escHtml(o)}</span>`).join('')}</div>`
}

export function emptyHintHtml(text = 'Drop people here') {
  return `<div class="g-empty">${escHtml(text)}</div>`
}

export function capacityInfo(group) {
  const s = groupStats(group.id)
  return { vacant: s.vacant, over: s.over }
}
