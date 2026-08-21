// ════════════════════════════════════════════════════════════
//  render.js: the shell. Roster, toolbar state, board dispatch (diagram or
//  building), YAML panel, insights drawer, detail sheet. Renderers return
//  HTML strings; this file owns the DOM targets.
// ════════════════════════════════════════════════════════

import { state, ui, allGroups, topGroups, childrenOf, membershipsOf, canUndo, canRedo, debouncedSave } from './state.js'
import { $, escHtml, fmtFte, plural, showToast } from './utils.js'
import { computeInsights, bandOf } from './allocation.js'
import { renderMarkdown } from './markdown.js'
import { emitYaml } from './yaml.js'
import { renderDiagram } from './render-diagram.js'
import { renderBuilding } from './render-building.js'
import { beginFrame, faceHtml, totals } from './parts.js'
import { loadPixelFont } from './avatar.js'

let lastLayout = null
export const getLayout = () => lastLayout

// The YAML panel regenerates only when the model changed (rev moves) and the
// visitor is not mid-edit. After a successful apply/import the text the
// visitor wrote stays in the panel, comments and all, until the next change.
let rev = 0, renderedRev = -1, keepOnce = false

/** Call after every mutation that should persist: saves, re-renders, and regenerates the YAML. */
export function afterChange() {
  rev++
  debouncedSave()
  if (ui.yamlDirty) { ui.yamlDirty = false; showToast('YAML regenerated from the board; unapplied edits were replaced') }
  render()
}

/** The panel text matches the model (it was just applied): keep it through the next render. */
export function markYamlInSync(text) {
  const ta = $('yamlText')
  if (ta) ta.value = text
  ui.yamlText = text
  ui.yamlDirty = false
  keepOnce = true
}

export function render() {
  beginFrame()
  document.title = (state.meta.title ? state.meta.title + ' · ' : '') + 'Floorplan | Team Map Builder'
  renderToolbar()
  renderRoster()
  renderBoard()
  renderYaml()
  renderInsights()
  renderDetail()
}

// ── Toolbar / header state ───────────────────────────────────
export function renderToolbar() {
  const mode = state.meta.mode
  document.body.dataset.mode = mode
  document.querySelectorAll('.mode-btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)))
  const title = $('docTitle')
  if (title && document.activeElement !== title) title.value = state.meta.title
  $('undoBtn')?.toggleAttribute('disabled', !canUndo())
  $('redoBtn')?.toggleAttribute('disabled', !canRedo())
  $('yamlToggle')?.setAttribute('aria-pressed', String(ui.yamlOpen))
  $('yamlPanel')?.toggleAttribute('hidden', !ui.yamlOpen)
  document.body.classList.toggle('yaml-open', ui.yamlOpen)
  $('avatarsToggle')?.setAttribute('aria-pressed', String(ui.avatars))
  const scale = $('scaleRange'); if (scale) scale.value = String(ui.scale)
  $('visitBtn')?.setAttribute('aria-pressed', String(ui.visiting))
  $('fitBtn')?.setAttribute('aria-pressed', String(ui.fit))
  document.body.classList.toggle('embed', ui.embed)
  document.body.classList.toggle('readonly', ui.readonly)
  const notes = $('docNotes')
  if (notes) {
    const has = !!state.meta.notes.trim()
    notes.hidden = !has
    if (has) notes.innerHTML = renderMarkdown(state.meta.notes)
  }
}

// ── Roster ───────────────────────────────────────────────────
export function renderRoster() {
  const list = $('rosterList'); if (!list) return
  const people = Object.values(state.people)
  const t = totals()
  const fte = people.reduce((s, p) => s + Math.min(100, t.get(p.id)?.total || 0), 0) / 100
  const count = $('rosterCount'); if (count) count.textContent = people.length ? `${plural(people.length, 'person', 'people')} · ${fmtFte(fte)} FTE` : ''
  if (!people.length) {
    list.innerHTML = '<p class="roster-empty">Nobody yet. Add a name below, paste an outline, or load an example.</p>'
    return
  }
  list.innerHTML = people.map(p => {
    const tt = t.get(p.id), band = bandOf(tt)
    const picked = ui.picked?.person === p.id && !ui.picked?.from
    const sel = ui.selection?.type === 'person' && ui.selection.id === p.id
    const where = tt.parts.map(x => `${x.group.name} ${x.pct}%`).join(', ') || 'not on a team'
    return `<div class="chip${picked ? ' is-picked' : ''}${sel ? ' is-selected' : ''}" data-drag="person" data-person="${p.id}" data-band="${band}" tabindex="0" role="button" aria-label="${escHtml(p.name)}, ${tt.total}% allocated: ${escHtml(where)}. Enter to pick up, then Enter on a group to seat.">
      ${faceHtml(p, p.color || '#475569', { px: 32 })}
      <span class="chip-meta">
        <span class="chip-name">${escHtml(p.name)}</span>
        <span class="chip-sub">${p.location ? escHtml(p.location) + ' · ' : ''}<span class="chip-pct" data-band="${band}">${tt.count ? tt.total + '%' : 'unassigned'}</span></span>
        <span class="chip-bar" aria-hidden="true"><i style="width:${Math.min(100, tt.total)}%" data-band="${band}"></i></span>
      </span>
      <button type="button" class="chip-remove" data-action="remove-person" data-id="${p.id}" aria-label="Remove ${escHtml(p.name)}">×</button>
    </div>`
  }).join('')
}

// ── Board ────────────────────────────────────────────────────
export function renderBoard() {
  const board = $('board'); if (!board) return
  const mode = state.meta.mode
  board.dataset.mode = mode
  const empty = !Object.keys(state.groups).length
  if (empty) {
    lastLayout = null
    board.innerHTML = `<div class="board-empty">
      <h2>Nothing on the floor yet</h2>
      <p>Add a group with <strong>+ Group</strong>, paste a markdown outline, write YAML in the side panel, or start from an example.</p>
      <div class="toolbar"><button type="button" class="btn btn--primary" data-action="load-example" data-id="atlas">Load Atlas Program</button><button type="button" class="btn btn--secondary" data-action="load-example" data-id="revenue">Load Revenue Platform</button></div>
    </div>`
    return
  }
  if (mode === 'building') {
    loadPixelFont()
    const { html, layout } = renderBuilding()
    lastLayout = layout
    if (ui.fit) {
      const avail = Math.max(200, board.clientWidth - 48)
      ui.scale = Math.max(0.4, Math.min(1.4, Math.floor((avail / (layout.cols * state.meta.cell)) * 20) / 20))
    }
    board.style.setProperty('--cell', `${Math.round(state.meta.cell * ui.scale)}px`)
    board.innerHTML = html
  } else {
    lastLayout = null
    board.innerHTML = renderDiagram()
  }
  document.body.classList.toggle('picking', !!ui.picked)
  document.dispatchEvent(new CustomEvent('floorplan:board'))
}

// ── YAML panel ───────────────────────────────────────────────
export function renderYaml({ force = false } = {}) {
  const ta = $('yamlText'); if (!ta) return
  const status = $('yamlStatus')
  if (keepOnce && !force) {
    keepOnce = false; renderedRev = rev
    if (status) status.textContent = 'In sync with the board. Your text is kept until the board changes.'
    renderYamlMessages(); return
  }
  if (ui.yamlDirty && !force) return
  if (renderedRev === rev && !force) { renderYamlMessages(); return }
  const { text, flattened } = emitYaml(state)
  ui.yamlText = text
  if (ta.value !== text) { ta.value = text; if (document.activeElement !== ta) ta.scrollTop = 0 }
  renderedRev = rev
  if (status) status.textContent = flattened.length
    ? `Flattened extends on ${flattened.join(', ')}: a profile member was removed, so that group is written in full.`
    : 'Regenerated from the board. Comments are not kept.'
  renderYamlMessages()
}
export function renderYamlMessages() {
  const box = $('yamlErrors'); if (!box) return
  const errs = ui.errors || [], warns = ui.warnings || []
  if (!errs.length && !warns.length) { box.hidden = true; box.innerHTML = ''; return }
  box.hidden = false
  box.innerHTML = errs.map(e => `<div class="yaml-msg yaml-msg--error">${escHtml(e)}</div>`).join('')
    + warns.map(w => `<div class="yaml-msg yaml-msg--warn">${escHtml(w)}</div>`).join('')
}

// ── Insights ─────────────────────────────────────────────────
export function renderInsights() {
  const items = computeInsights(lastLayout)
  const badge = $('insightBadge')
  const loud = items.filter(i => i.severity !== 'low').length
  if (badge) {
    badge.hidden = items.length === 0
    badge.textContent = String(items.length)
    badge.dataset.high = items.some(i => i.severity === 'high') ? '1' : '0'
    badge.dataset.loud = loud ? '1' : '0'
  }
  const list = $('insightList'); if (!list) return
  if (!items.length) {
    list.innerHTML = '<div class="insight insight--ok"><span class="insight-dot"></span><div><div class="insight-title">Nothing to flag</div><div class="insight-detail">Everyone sums to 100%, no empty groups, no rooms over capacity.</div></div></div>'
    return
  }
  list.innerHTML = `<ul class="insight-items">${items.map(i => `<li class="insight insight--${i.severity}"${i.ref ? ` data-action="focus-ref" data-type="${i.ref.type}" data-id="${i.ref.id}" tabindex="0"` : ''}>
    <span class="insight-dot"></span>
    <div><div class="insight-title">${escHtml(i.title)}</div><div class="insight-detail">${escHtml(i.detail)}</div></div>
  </li>`).join('')}</ul>`
  document.body.classList.toggle('drawer-open', ui.drawerOpen)
}

// ── Detail sheet ─────────────────────────────────────────────
export function renderDetail() {
  const sheet = $('detailSheet'); if (!sheet) return
  const sel = ui.selection
  const active = document.activeElement
  if (sheet.contains(active) && active.matches('input, textarea')) return  // do not yank focus mid-edit
  if (!sel || (sel.type === 'person' && !state.people[sel.id]) || (sel.type === 'group' && !state.groups[sel.id])) {
    sheet.hidden = true; sheet.innerHTML = ''; document.body.classList.remove('detail-open'); return
  }
  sheet.hidden = false
  document.body.classList.add('detail-open')
  sheet.innerHTML = sel.type === 'person' ? personDetail(state.people[sel.id]) : groupDetail(state.groups[sel.id])
}

const field = (label, name, value, { type = 'text', placeholder = '' } = {}) =>
  `<label class="sheet-field"><span>${label}</span><input type="${type}" data-field="${name}" value="${escHtml(value ?? '')}" placeholder="${escHtml(placeholder)}"></label>`

function personDetail(p) {
  const t = totals().get(p.id)
  const shares = t.parts.map(x => `<li><span class="share-name">${escHtml(x.group.name)}</span>
      <input type="number" min="1" max="100" step="5" value="${x.pct}" data-share="${x.group.id}:${p.id}" aria-label="Share in ${escHtml(x.group.name)}"><span class="share-pct">%</span>
      <button type="button" class="btn btn--ghost btn--sm" data-action="unassign" data-group="${x.group.id}" data-person="${p.id}">Remove</button></li>`).join('')
  return `<header class="sheet-head"><h2>${escHtml(p.name)}</h2><button type="button" class="btn btn--ghost btn--icon" data-action="close-detail" aria-label="Close">×</button></header>
  <div class="sheet-body">
    <div class="sheet-face">${faceHtml(p, t.parts[0]?.group.color || p.color || '#475569', { px: 48 })}<span class="sheet-total" data-band="${bandOf(t)}">${t.count ? t.total + '% allocated' : 'Unassigned'}</span></div>
    ${field('Name', 'person.name', p.name)}
    ${field('Location', 'person.location', p.location, { placeholder: 'City or country' })}
    ${field('Role', 'person.role', p.role, { placeholder: 'Developer, QA, Product...' })}
    ${p.extends.length ? `<p class="sheet-hint">Extends profile: ${p.extends.map(escHtml).join(', ')}</p>` : ''}
    <label class="sheet-field"><span>Notes (markdown)</span><textarea data-field="person.notes" rows="4" placeholder="Anything the map should remember about this person">${escHtml(p.notes)}</textarea></label>
    ${p.notes.trim() ? `<div class="md-preview">${renderMarkdown(p.notes)}</div>` : ''}
    <h3 class="sheet-sub">Shares</h3>
    ${shares ? `<ul class="share-list">${shares}</ul>` : '<p class="sheet-hint">Not on any team. Drag the chip onto a group.</p>'}
    ${t.count > 1 ? `<button type="button" class="btn btn--secondary btn--sm" data-action="balance" data-id="${p.id}">Balance shares to 100%</button>` : ''}
    <div class="sheet-actions"><button type="button" class="btn btn--danger btn--sm" data-action="remove-person" data-id="${p.id}">Delete person</button></div>
  </div>`
}

function groupDetail(g) {
  const own = g.members.map(m => {
    const p = state.people[m.person]; if (!p) return ''
    return `<li><span class="share-name">${escHtml(p.name)}</span>
      <input type="number" min="1" max="100" step="5" value="${m.pct}" data-share="${g.id}:${p.id}" aria-label="Share of ${escHtml(p.name)}"><span class="share-pct">%</span>
      <button type="button" class="btn btn--ghost btn--sm" data-action="unassign" data-group="${g.id}" data-person="${p.id}">Remove</button></li>`
  }).join('')
  const rooms = allGroups().filter(x => x.kind === 'group')
  const spanOpts = g.kind === 'band' ? `<fieldset class="sheet-field"><legend>Spans</legend><div class="span-grid">${rooms.map(r => `<label><input type="checkbox" data-span="${r.id}" ${g.spans.includes(r.id) ? 'checked' : ''}> ${escHtml(r.name)}</label>`).join('')}</div></fieldset>` : ''
  const kindLabel = g.kind === 'band' ? 'Shared space' : (g.parent ? 'Sub-group' : 'Group')
  return `<header class="sheet-head"><h2>${escHtml(g.name)}</h2><button type="button" class="btn btn--ghost btn--icon" data-action="close-detail" aria-label="Close">×</button></header>
  <div class="sheet-body">
    <p class="sheet-hint">${kindLabel}${g.parent ? ` in ${escHtml(state.groups[g.parent]?.name || '')}` : ''}${g.extends.length ? ` · extends ${g.extends.map(escHtml).join(', ')}` : ''}</p>
    ${field('Name', 'group.name', g.name)}
    <div class="sheet-row">
      <label class="sheet-field sheet-field--color"><span>Colour</span><input type="color" data-field="group.color" value="${escHtml(g.color || '#64748b')}"></label>
      ${field('Capacity', 'group.capacity', g.capacity ?? '', { type: 'number', placeholder: 'seats' })}
    </div>
    ${field('Owns (comma separated)', 'group.owns', g.owns.join(', '), { placeholder: 'Checkout, Payments' })}
    ${spanOpts}
    <label class="sheet-field"><span>Notes (markdown)</span><textarea data-field="group.notes" rows="4" placeholder="Mission, rituals, links">${escHtml(g.notes)}</textarea></label>
    ${g.notes.trim() ? `<div class="md-preview">${renderMarkdown(g.notes)}</div>` : ''}
    <h3 class="sheet-sub">Members</h3>
    ${own ? `<ul class="share-list">${own}</ul>` : '<p class="sheet-hint">No direct members. Drop people onto this group.</p>'}
    <div class="sheet-actions">
      ${g.kind === 'group' ? `<button type="button" class="btn btn--secondary btn--sm" data-action="add-subgroup" data-id="${g.id}">+ Sub-group</button>` : ''}
      <button type="button" class="btn btn--ghost btn--sm" data-action="move-group" data-id="${g.id}" data-dir="-1" aria-label="Move earlier">◀</button>
      <button type="button" class="btn btn--ghost btn--sm" data-action="move-group" data-id="${g.id}" data-dir="1" aria-label="Move later">▶</button>
      ${g.layout ? `<button type="button" class="btn btn--ghost btn--sm" data-action="clear-layout" data-id="${g.id}" title="Let the packer place this room">Auto place</button>` : ''}
      <button type="button" class="btn btn--danger btn--sm" data-action="remove-group" data-id="${g.id}">Delete</button>
    </div>
  </div>`
}
