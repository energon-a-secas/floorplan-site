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
import { loadPixelFont, PRESETS, avatarDataUrl, KINDS, HAIR_STYLES, ITEMS, SKIN, HAIR, COAT, avatarSpec } from './avatar.js'
import { refreshDiff, baseLabel, baseModel } from './diff.js'

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
  refreshDiff()
  document.title = (state.meta.title ? state.meta.title + ' · ' : '') + 'Floorplan | Team Map Builder'
  renderToolbar()
  renderVersions()
  renderRoster()
  renderBoard()
  renderYaml()
  renderInsights()
  renderChanges()
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
  const disp = state.meta.display || {}
  ui.avatars = disp.avatars !== 'initials'
  document.body.classList.toggle('display-align-center', disp.align === 'center')
  document.body.classList.toggle('display-shares-hidden', disp.shares === 'hidden')
  document.body.classList.toggle('display-shares-badges', disp.shares === 'badges')
  document.body.classList.toggle('display-locations-off', disp.locations === false)
  document.querySelectorAll('#displayMenu input[name]').forEach(inp => {
    if (inp.type === 'checkbox') inp.checked = disp[inp.name] !== false
    else inp.checked = String(disp[inp.name]) === inp.value
  })
  const scale = $('scaleRange'); if (scale) scale.value = String(ui.scale)
  $('visitBtn')?.setAttribute('aria-pressed', String(ui.visiting))
  $('fitBtn')?.setAttribute('aria-pressed', String(ui.fit))
  document.body.classList.toggle('embed', ui.embed)
  document.body.classList.toggle('readonly', ui.readonly)
  document.body.classList.toggle('previewing', !!ui.preview)
  document.body.classList.toggle('comparing', !!ui.compare)
  $('versionsBtn')?.setAttribute('aria-pressed', String(ui.versionsOpen))
  const vc = $('versionsCount'); if (vc) { vc.hidden = !state.history.length; vc.textContent = String(state.history.length) }
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
    ${avatarPicker(p, t.parts[0]?.group.color || p.color || '#475569')}
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


// ── Versions strip + preview banner ──────────────────────────
export function renderVersions() {
  const bar = $('versionsBar'); if (!bar) return
  const h = state.history
  const open = ui.versionsOpen || !!ui.preview || !!ui.compare
  bar.hidden = !open
  const banner = $('previewBanner')
  if (banner) {
    banner.hidden = !ui.preview
    if (ui.preview) {
      const e = h[ui.preview.index]
      banner.innerHTML = `<span class="pb-text">Viewing <strong>v${ui.preview.index + 1}</strong>${e?.date ? ' · ' + escHtml(e.date) : ''}${e?.label ? ' · ' + escHtml(e.label) : ''} <em>(read-only)</em></span>
        <span class="toolbar"><button type="button" class="btn btn--primary btn--sm" data-action="restore-version">Restore this version</button><button type="button" class="btn btn--ghost btn--sm" data-action="delete-version" data-idx="${ui.preview.index}">Delete</button><button type="button" class="btn btn--secondary btn--sm" data-action="exit-preview">Back to now</button></span>`
    }
  }
  if (!open) return
  const chips = h.map((e, i) => `<button type="button" class="vb-chip${ui.preview?.index === i ? ' is-current' : ''}${ui.compare?.kind === 'version' && ui.compare.index === i ? ' is-base' : ''}" data-action="preview-version" data-idx="${i}" title="${escHtml(e.label || 'Snapshot')} ${escHtml(e.date)}"><b>v${i + 1}</b><span>${escHtml(e.date || '')}</span>${e.label ? `<i>${escHtml(e.label)}</i>` : ''}</button>`).join('<span class="vb-link" aria-hidden="true"></span>')
  const compareOpts = h.map((e, i) => `<option value="${i}"${ui.compare?.kind === 'version' && ui.compare.index === i ? ' selected' : ''}>v${i + 1} · ${escHtml(e.date)}${e.label ? ' · ' + escHtml(e.label) : ''}</option>`).join('')
  bar.innerHTML = `<div class="vb-row">
    <span class="vb-label">Versions</span>
    <div class="vb-track">${chips}${h.length ? '<span class="vb-link" aria-hidden="true"></span>' : ''}<button type="button" class="vb-chip vb-chip--now${ui.preview ? '' : ' is-current'}" data-action="exit-preview"><b>Now</b></button></div>
    ${h.length ? `<input type="range" class="vb-scrub" id="versionScrub" min="0" max="${h.length}" value="${ui.preview ? ui.preview.index : h.length}" aria-label="Scrub through versions" title="Scrub through versions">` : ''}
    ${ui.readonly ? '' : `<form class="vb-snap" id="snapForm" autocomplete="off"><input type="text" id="snapLabel" class="roster-input" placeholder="Label, e.g. Before reorg" maxlength="60" aria-label="Snapshot label"><button type="submit" class="btn btn--primary btn--sm">Snapshot now</button></form>`}
  </div>
  <div class="vb-row vb-row--compare">
    <label class="vb-compare"><span>Compare now with</span>
      <select id="compareBase" aria-label="Baseline to compare with">
        <option value="">nothing</option>
        ${compareOpts}
        <option value="external"${ui.compare?.kind === 'external' ? ' selected' : ''}>${ui.compare?.kind === 'external' ? escHtml(ui.compare.label || 'pasted document') : 'a pasted document…'}</option>
      </select></label>
    ${ui.compare ? `<span class="vb-summary">${escHtml(changeSummary())}</span><button type="button" class="btn btn--ghost btn--sm" data-action="drawer-tab" data-tab="changes">Open changes</button><button type="button" class="btn btn--ghost btn--sm" data-action="compare-clear">Stop comparing</button>` : `<span class="vb-hint">${h.length ? 'Pick a snapshot to see who moved, who joined, who left, and which shares changed.' : 'Take a snapshot before a change, edit, then compare.'}</span>`}
  </div>`
}

function changeSummary() {
  const s = ui.diff?.summary; if (!s) return ''
  if (!s.total) return 'No differences'
  const bits = []
  if (s.moves) bits.push(plural(s.moves, 'move'))
  if (s.joined) bits.push(`${s.joined} joined`)
  if (s.left) bits.push(`${s.left} left`)
  if (s.shares) bits.push(plural(s.shares, 'share change'))
  if (s.groups) bits.push(plural(s.groups, 'group change'))
  if (s.people) bits.push(plural(s.people, 'person change', 'people changes'))
  if (s.links) bits.push(plural(s.links, 'link change'))
  if (s.layout) bits.push(plural(s.layout, 'room moved', 'rooms moved'))
  return bits.join(' · ')
}

// ── Changes tab in the drawer ────────────────────────────────
export function renderChanges() {
  const list = $('changesList'); if (!list) return
  document.querySelectorAll('#drawerTabs [data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === ui.drawerTab)))
  $('insightList')?.toggleAttribute('hidden', ui.drawerTab !== 'insights')
  list.toggleAttribute('hidden', ui.drawerTab !== 'changes')
  const cb = $('changesBadge'); if (cb) { cb.hidden = !ui.diff?.summary.total; cb.textContent = String(ui.diff?.summary.total || 0) }
  if (!ui.compare) { list.innerHTML = '<p class="sheet-hint">Not comparing. Open <strong>Versions</strong> and pick a baseline, or paste a document.</p>'; return }
  const d = ui.diff
  if (!d || !d.summary.total) { list.innerHTML = `<p class="sheet-hint">No differences against ${escHtml(baseLabel())}.</p>`; return }
  const bm = baseModel()
  const gname = id => state.groups[id]?.name || bm?.groups[id]?.name || id
  const pname = id => state.people[id]?.name || bm?.people[id]?.name || id
  const item = (sev, title, detail, ref) => `<li class="insight insight--${sev}"${ref ? ` data-action="focus-ref" data-type="${ref.type}" data-id="${ref.id}" tabindex="0"` : ''}><span class="insight-dot"></span><div><div class="insight-title">${title}</div>${detail ? `<div class="insight-detail">${detail}</div>` : ''}</div></li>`
  const sec = (title, items) => items.length ? `<div class="drawer-subhead">${title} (${items.length})</div><ul class="insight-items">${items.join('')}</ul>` : ''
  const out = [`<p class="sheet-hint">Now vs <strong>${escHtml(baseLabel())}</strong>: ${escHtml(changeSummary())}</p>`]
  out.push(sec('Moved', d.moves.map(m => item('medium', `${escHtml(pname(m.person))}: ${escHtml(gname(m.from))} → ${escHtml(gname(m.to))}`, m.fromPct !== m.pct ? `${m.fromPct}% → ${m.pct}%` : `${m.pct}%`, state.people[m.person] ? { type: 'person', id: m.person } : null))))
  out.push(sec('Joined', d.memberships.filter(m => m.kind === 'joined' && !m.moved).map(m => item('low', `${escHtml(pname(m.person))} joined ${escHtml(gname(m.group))}`, `${m.to}%${d.people.added.includes(m.person) ? ' · new person' : ''}`, { type: 'person', id: m.person }))))
  out.push(sec('Left', d.memberships.filter(m => m.kind === 'left' && !m.moved).map(m => item('high', `${escHtml(pname(m.person))} left ${escHtml(gname(m.group))}`, `was ${m.from}%${d.people.removed.includes(m.person) ? ' · no longer in the document' : ''}`, state.people[m.person] ? { type: 'person', id: m.person } : null))))
  out.push(sec('Share changes', d.memberships.filter(m => m.kind === 'share').map(m => item('medium', `${escHtml(pname(m.person))} in ${escHtml(gname(m.group))}: ${m.from}% → ${m.to}%`, '', { type: 'person', id: m.person }))))
  out.push(sec('Groups', [
    ...d.groups.added.map(id => item('low', `Added ${escHtml(gname(id))}`, '', { type: 'group', id })),
    ...d.groups.removed.map(id => item('high', `Removed ${escHtml(gname(id))}`, '', null)),
    ...d.groups.changed.map(c => item('medium', `${escHtml(gname(c.id))} changed`, escHtml(Object.entries(c.fields).map(([k, [a, b]]) => `${k}: ${a ?? 'none'} → ${b ?? 'none'}`).join(' · ')), { type: 'group', id: c.id })),
  ]))
  out.push(sec('People', [
    ...d.people.added.filter(id => !d.memberships.some(m => m.person === id && m.kind === 'joined')).map(id => item('low', `Added ${escHtml(pname(id))}`, 'not seated yet', { type: 'person', id })),
    ...d.people.removed.filter(id => !d.memberships.some(m => m.person === id && m.kind === 'left')).map(id => item('high', `Removed ${escHtml(pname(id))}`, '', null)),
    ...d.people.changed.map(c => item('low', `${escHtml(pname(c.id))} changed`, escHtml(Object.entries(c.fields).map(([k, [a, b]]) => `${k}: ${a || 'none'} → ${b || 'none'}`).join(' · ')), { type: 'person', id: c.id })),
  ]))
  out.push(sec('Links', [
    ...d.links.added.map(l => item('low', `Linked ${escHtml(gname(l.from))} and ${escHtml(gname(l.to))}`, escHtml(l.label || ''), null)),
    ...d.links.removed.map(l => item('medium', `Unlinked ${escHtml(gname(l.from))} and ${escHtml(gname(l.to))}`, escHtml(l.label || ''), null)),
  ]))
  if (d.layout.length) out.push(sec('Rooms moved or resized', d.layout.map(id => item('low', escHtml(gname(id)), '', { type: 'group', id }))))
  list.innerHTML = out.join('')
}


// ── Avatar picker (person sheet) ─────────────────────────────
function avatarPicker(p, shirt) {
  const cur = p.avatar || null
  const spec = avatarSpec(p.name, cur)
  const activePreset = cur?.preset || (cur ? '' : 'seeded')
  const presets = PRESETS.map(pr => `<button type="button" class="av-preset${activePreset === pr.id ? ' is-active' : ''}" data-preset="${pr.id}" title="${escHtml(pr.name)}" aria-label="${escHtml(pr.name)}"><img src="${avatarDataUrl(p.name, shirt, pr.spec)}" width="30" height="30" alt="" class="px-avatar"></button>`).join('')
  const opt = (list, val, labels) => list.map((v, i) => `<option value="${v}"${String(val) === String(v) ? ' selected' : ''}>${labels ? labels[i] : v}</option>`).join('')
  const swatches = (name, colors, val) => `<span class="swatches">${colors.map((c, i) => `<button type="button" class="swatch${val === c ? ' is-active' : ''}" data-av="${name}" data-value="${c}" style="--sw:${c}" aria-label="${name} ${i + 1}"></button>`).join('')}</span>`
  const isPerson = spec.kind === 'person'
  return `<fieldset class="sheet-field av-fieldset"><legend>Avatar</legend>
    <div class="av-grid">${presets}</div>
    <div class="av-fields">
      <label>Kind <select data-av="kind">${opt(KINDS, spec.kind)}</select></label>
      ${isPerson ? `<label>Hair <select data-av="hair">${opt(HAIR_STYLES, HAIR_STYLES[spec.style])}</select></label>` : ''}
      <label>Item <select data-av="item">${opt(ITEMS, spec.item)}</select></label>
      ${isPerson ? `<label><input type="checkbox" data-av="glasses" ${spec.glasses ? 'checked' : ''}> Glasses</label><label><input type="checkbox" data-av="beard" ${spec.beard ? 'checked' : ''}> Beard</label>` : (spec.kind !== 'robot' ? `<label><input type="checkbox" data-av="glasses" ${spec.glasses ? 'checked' : ''}> Glasses</label>` : '')}
    </div>
    ${isPerson ? `<div class="av-row"><span>Skin</span>${swatches('skin', SKIN, spec.skin)}</div><div class="av-row"><span>Hair</span>${swatches('hairColor', HAIR, spec.hair)}</div>` : (spec.kind !== 'robot' ? `<div class="av-row"><span>Coat</span>${swatches('coat', COAT, spec.coat)}</div>` : '')}
    <div class="av-row"><span>Shirt</span><input type="color" data-av="shirt" value="${escHtml(spec.shirt || shirt)}" aria-label="Shirt colour"> <button type="button" class="btn btn--ghost btn--sm" data-av="shirt" data-value="">Group colour</button>${cur ? ` <button type="button" class="btn btn--ghost btn--sm" data-preset="seeded">Reset to seeded</button>` : ''}</div>
  </fieldset>`
}
