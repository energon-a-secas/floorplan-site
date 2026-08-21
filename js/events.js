// ════════════════════════════════════════════════════════════
//  events.js: every click, key and form event, delegated on document so a
//  wholesale re-render never needs rebinding. Mutations follow one shape:
//  snapshot() -> mutate -> afterChange(). Cmd/Ctrl+Z is ignored while typing
//  in a field (loadout-site undid the board from inside a text input).
// ════════════════════════════════════════════════════════════

import {
  state, ui, snapshot, undo, redo, addPerson, removePerson, addGroup, removeGroup, updateGroup, updatePerson,
  setMembership, removeMembership, reorderGroup, setLayout, clearLayouts, setMode, resetTo, clearAll, membershipsOf,
} from './state.js'
import { render, renderBoard, renderRoster, renderDetail, renderToolbar, renderYaml, renderYamlMessages, markYamlInSync, afterChange } from './render.js'
import { $, showToast, copyText, clamp } from './utils.js'
import { parseYaml } from './yaml.js'
import { exampleById } from './examples.js'
import { bindDnd, commitDrop } from './dnd.js'
import { exportYamlFile, exportJsonFile, exportMarkdownFile, exportMermaidFile, copyShareLink, importFile, importText } from './export.js'
import { exportSVG, exportPNG } from './image-export.js'

export function bindEvents() {
  bindDnd()
  document.addEventListener('click', onClick)
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('input', onInput)
  document.addEventListener('change', onChange)
  document.addEventListener('focusin', onFocusIn)

  $('addPersonForm')?.addEventListener('submit', e => { e.preventDefault(); addPersonFromForm() })
  const ta = $('yamlText')
  ta?.addEventListener('input', () => {
    ui.yamlDirty = ta.value !== ui.yamlText
    const s = $('yamlStatus'); if (s) s.textContent = ui.yamlDirty ? 'Edited, not applied. Apply with the button or Cmd/Ctrl+Enter.' : 'In sync with the board.'
  })
  ta?.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); applyYaml() } })
  $('importFile')?.addEventListener('change', e => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = '' })
  $('scaleRange')?.addEventListener('input', e => { ui.scale = Number(e.target.value) || 1; renderBoard() })
  setupMenu('examplesBtn', 'examplesMenu')
  setupMenu('exportBtn', 'exportMenu')
}

// ── Menus (.header-menu, toggled by the site; Esc/outside handled here) ──
function setupMenu(btnId, menuId) {
  const btn = $(btnId), menu = $(menuId)
  if (!btn || !menu) return
  const close = () => { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false') }
  btn.addEventListener('click', e => {
    e.stopPropagation()
    const open = !menu.classList.contains('open')
    document.querySelectorAll('.header-menu.open').forEach(m => m.classList.remove('open'))
    menu.classList.toggle('open', open)
    btn.setAttribute('aria-expanded', String(open))
    if (open) menu.querySelector('[role="menuitem"]')?.focus()
  })
  document.addEventListener('click', e => { if (!menu.contains(e.target) && e.target !== btn) close() })
  menu.addEventListener('click', e => { if (e.target.closest('[role="menuitem"]')) close() })
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && menu.classList.contains('open')) { close(); btn.focus() } })
}

// ── Clicks ───────────────────────────────────────────────────
function onClick(e) {
  const t = e.target
  const act = t.closest('[data-action]')
  if (act) { runAction(act.dataset.action, act, e); return }

  const modeBtn = t.closest('.mode-btn')
  if (modeBtn) { switchMode(modeBtn.dataset.mode); return }
  const ex = t.closest('[data-example]')
  if (ex) { loadExample(ex.dataset.example); return }
  const exp = t.closest('[data-export]')
  if (exp) { runExport(exp.dataset.export); return }
  const badge = t.closest('.pct-badge')
  if (badge) { e.stopPropagation(); openPctEditor(badge); return }

  // carrying someone (keyboard pick-up) and clicking a target seats them
  const drop = t.closest('[data-drop]')
  if (ui.picked && drop && !t.closest('[data-drag]')) {
    const ok = commitDrop(ui.picked.person, ui.picked.from, drop, { split: e.altKey })
    ui.picked = null
    if (!ok) { renderBoard(); renderRoster() }
    return
  }
  const person = t.closest('[data-drag="person"]')
  if (person) { select('person', person.dataset.person); return }
  const head = t.closest('[data-group-head]')
  if (head) { select('group', head.dataset.groupHead); return }
  if (t.closest('.room--title')) { select('group', t.closest('.room--title').dataset.group); return }
}

function runAction(action, el, e) {
  const id = el.dataset.id
  switch (action) {
    case 'select-group': select('group', id); break
    case 'close-detail': ui.selection = null; renderDetail(); renderBoard(); renderRoster(); break
    case 'remove-person': snapshot(); removePerson(id); afterChange(); showToast('Person removed. Cmd/Ctrl+Z to undo'); break
    case 'remove-group': snapshot(); removeGroup(id); afterChange(); showToast('Group removed. Cmd/Ctrl+Z to undo'); break
    case 'unassign': snapshot(); removeMembership(el.dataset.group, el.dataset.person); afterChange(); break
    case 'balance': balance(id); break
    case 'add-subgroup': { snapshot(); const g = addGroup({ name: 'New sub-group', parent: id }); afterChange(); if (g) select('group', g.id, { focusName: true }); break }
    case 'add-group': { snapshot(); const g = addGroup({ name: 'New group' }); afterChange(); if (g) select('group', g.id, { focusName: true }); break }
    case 'add-band': { snapshot(); const g = addGroup({ name: 'Shared space', kind: 'band' }); afterChange(); if (g) select('group', g.id, { focusName: true }); break }
    case 'move-group': snapshot(); reorderGroup(id, Number(el.dataset.dir)); afterChange(); break
    case 'clear-layout': snapshot(); setLayout(id, null); afterChange(); break
    case 'relayout': snapshot(); clearLayouts(); afterChange(); showToast('Layout cleared; rooms packed automatically'); break
    case 'load-example': loadExample(id); break
    case 'focus-ref': focusRef(el.dataset.type, el.dataset.id); break
    case 'toggle-insights': ui.drawerOpen = !ui.drawerOpen; document.body.classList.toggle('drawer-open', ui.drawerOpen); break
    case 'close-insights': ui.drawerOpen = false; document.body.classList.remove('drawer-open'); break
    case 'toggle-yaml': ui.yamlOpen = !ui.yamlOpen; renderToolbar(); if (ui.yamlOpen) { renderYaml(); $('yamlText')?.focus() } break
    case 'yaml-apply': applyYaml(); break
    case 'yaml-copy': copyText($('yamlText').value).then(ok => showToast(ok ? 'YAML copied' : 'Clipboard blocked')); break
    case 'yaml-regen': ui.yamlDirty = false; renderYaml({ force: true }); showToast('YAML regenerated from the board'); break
    case 'undo': doUndo(); break
    case 'redo': doRedo(); break
    case 'clear': snapshot(); clearAll(); ui.selection = null; ui.picked = null; afterChange(); showToast('Board cleared. Cmd/Ctrl+Z brings it back'); break
    case 'toggle-avatars': ui.avatars = !ui.avatars; renderToolbar(); renderBoard(); renderRoster(); renderDetail(); break
    case 'visit': toggleVisit(); break
    case 'import-open': $('importDialog')?.showModal(); $('importText')?.focus(); break
    case 'import-close': $('importDialog')?.close(); break
    case 'import-apply': { const text = $('importText').value; if (importText(text)) { $('importDialog').close(); $('importText').value = '' } break }
    case 'import-file': $('importFile')?.click(); break
    case 'share': copyShareLink(); break
    case 'help': $('helpDialog')?.showModal(); break
    case 'dialog-close': el.closest('dialog')?.close(); break
    default: break
  }
}

function select(type, id, { focusName = false } = {}) {
  ui.selection = { type, id }
  renderDetail(); renderBoard(); renderRoster()
  if (focusName) { const inp = $('detailSheet')?.querySelector('[data-field$=".name"]'); if (inp) { inp.focus(); inp.select() } }
}

function focusRef(type, id) {
  ui.drawerOpen = false; document.body.classList.remove('drawer-open')
  select(type, id)
  const sel = type === 'person' ? `[data-drag="person"][data-person="${CSS.escape(id)}"]` : `[data-drop="group"][data-group="${CSS.escape(id)}"]`
  const el = document.querySelector(`#board ${sel}`) || document.querySelector(sel)
  el?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
  el?.classList.add('is-flash'); setTimeout(() => el?.classList.remove('is-flash'), 1200)
}

function switchMode(mode) {
  if (mode === state.meta.mode) return
  if (ui.visiting) toggleVisit()
  snapshot(); setMode(mode); afterChange()
}

function balance(personId) {
  const ms = membershipsOf(personId); if (!ms.length) return
  snapshot()
  const each = Math.floor(100 / ms.length)
  ms.forEach((m, i) => setMembership(m.group.id, personId, i === 0 ? 100 - each * (ms.length - 1) : each))
  afterChange()
}

function addPersonFromForm() {
  const name = $('personName').value.trim(), location = $('personLoc')?.value.trim() || ''
  if (!name) return
  snapshot()
  const p = addPerson({ name, location })
  $('personName').value = ''; if ($('personLoc')) $('personLoc').value = ''
  afterChange()
  if (p) { showToast(`${p.name} added. Drag them onto a group`); $('personName').focus() }
}

// ── Inline pct editor ────────────────────────────────────────
function openPctEditor(badge) {
  const [groupId, personId] = badge.dataset.pct.split(':')
  const g = state.groups[groupId]; const m = g?.members.find(x => x.person === personId)
  if (!m) return
  const input = document.createElement('input')
  input.type = 'number'; input.min = '1'; input.max = '100'; input.step = '5'; input.value = String(m.pct)
  input.className = 'pct-input'; input.setAttribute('aria-label', 'Share percent')
  badge.replaceWith(input)
  input.focus(); input.select()
  let done = false
  const finish = (commit) => {
    if (done) return; done = true
    const v = clamp(Math.round(Number(input.value)), 1, 100)
    if (commit && Number.isFinite(v) && v !== m.pct) { snapshot(); setMembership(groupId, personId, v); afterChange() }
    else renderBoard()
  }
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); finish(true) } if (e.key === 'Escape') { e.preventDefault(); finish(false) } e.stopPropagation() })
  input.addEventListener('blur', () => finish(true))
  input.addEventListener('pointerdown', e => e.stopPropagation())
}

// ── Detail sheet fields ──────────────────────────────────────
function onFocusIn(e) {
  if (e.target.closest('#detailSheet') && e.target.matches('[data-field], [data-share], [data-span]')) snapshot()
}
function onInput(e) {
  const t = e.target
  if (t.id === 'docTitle') { state.meta.title = t.value.trim().slice(0, 80); document.title = (state.meta.title ? state.meta.title + ' · ' : '') + 'Floorplan | Team Map Builder'; scheduleSoftChange(); return }
  if (t.id === 'docNotesInput') { state.meta.notes = t.value; scheduleSoftChange(); return }
  const field = t.dataset.field
  if (field && ui.selection) {
    const [kind, key] = field.split('.')
    if (kind === 'person') updatePerson(ui.selection.id, { [key]: t.value })
    if (kind === 'group') updateGroup(ui.selection.id, key === 'owns' ? { owns: t.value.split(',').map(s => s.trim()).filter(Boolean) } : { [key]: t.value })
    scheduleSoftChange()
    return
  }
  if (t.dataset.share) {
    const [g, p] = t.dataset.share.split(':')
    const v = Number(t.value)
    if (Number.isFinite(v) && v >= 1 && v <= 100) { setMembership(g, p, v); scheduleSoftChange() }
  }
}
function onChange(e) {
  const t = e.target
  if (t.dataset.span && ui.selection?.type === 'group') {
    const g = state.groups[ui.selection.id]; if (!g) return
    const spans = t.checked ? [...g.spans, t.dataset.span] : g.spans.filter(s => s !== t.dataset.span)
    updateGroup(g.id, { spans }); afterChange()
  }
}
// Typing re-renders the board and YAML but leaves the detail sheet alone (focus stays put).
let softTimer = null
function scheduleSoftChange() {
  clearTimeout(softTimer)
  softTimer = setTimeout(() => { ui.yamlDirty = false; renderToolbar(); renderBoard(); renderRoster(); renderYaml(); import('./render.js').then(m => m.renderInsights()); import('./state.js').then(m => m.debouncedSave()) }, 160)
}

// ── Keyboard ─────────────────────────────────────────────────
function onKeydown(e) {
  const src = e.target instanceof Element ? e.target : document.body
  const typing = src.closest('input, textarea, select, [contenteditable="true"]')
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    if (typing) return
    e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return
  }
  if (typing) return
  if (e.key === '?' && !e.metaKey && !e.ctrlKey) { $('helpDialog')?.showModal(); return }
  const el = document.activeElement
  if (e.key === 'Escape') {
    if (ui.picked) { ui.picked = null; renderBoard(); renderRoster(); return }
    if (ui.drawerOpen) { ui.drawerOpen = false; document.body.classList.remove('drawer-open'); return }
    if (ui.selection) { ui.selection = null; renderDetail(); renderBoard(); renderRoster(); return }
    return
  }
  if ((e.key === 'Enter' || e.key === ' ') && el?.matches('[data-drag="person"]')) {
    e.preventDefault()
    const same = ui.picked && ui.picked.person === el.dataset.person && (ui.picked.from || null) === (el.dataset.from || null)
    ui.picked = same ? null : { person: el.dataset.person, from: el.dataset.from || null }
    const sel = selectorFor(el)
    renderBoard(); renderRoster()
    document.querySelector(sel)?.focus()
    return
  }
  if (e.key === 'Enter' && ui.picked && el?.matches('[data-drop]')) {
    e.preventDefault()
    commitDrop(ui.picked.person, ui.picked.from, el, { split: e.altKey })
    ui.picked = null
    return
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && el?.matches('[data-seat]')) {
    e.preventDefault()
    const [g, p] = el.dataset.seat.split(':')
    snapshot(); removeMembership(g, p); afterChange()
  }
}
function selectorFor(el) {
  const p = CSS.escape(el.dataset.person)
  return el.dataset.from ? `[data-seat="${CSS.escape(el.dataset.from)}:${p}"]` : `#rosterList [data-person="${p}"]`
}

function doUndo() { if (undo()) { ui.picked = null; afterChange(); showToast('Undone') } }
function doRedo() { if (redo()) { ui.picked = null; afterChange(); showToast('Redone') } }

// ── YAML panel ───────────────────────────────────────────────
export function applyYaml() {
  const text = $('yamlText').value
  const { model, errors, warnings } = parseYaml(text)
  ui.errors = errors; ui.warnings = warnings
  if (!model || errors.length) { renderYamlMessages(); showToast(`${errors.length || 1} problem${errors.length === 1 ? '' : 's'} in the YAML`); return false }
  snapshot()
  resetTo(model)
  ui.yamlDirty = false
  markYamlInSync(text)
  afterChange()
  showToast(warnings.length ? `Applied with ${warnings.length} note${warnings.length === 1 ? '' : 's'}` : 'YAML applied')
  return true
}

export function loadExample(id) {
  const ex = exampleById(id); if (!ex) return
  const { model, errors } = parseYaml(ex.yaml)
  if (!model || errors.length) { showToast('Example failed to load'); console.error(errors); return }
  snapshot()
  resetTo(model)
  ui.selection = null; ui.picked = null; ui.errors = []; ui.warnings = []
  ui.yamlDirty = false
  markYamlInSync(ex.yaml)
  afterChange()
  showToast(`Loaded ${ex.name}. Cmd/Ctrl+Z brings back what was there`)
}

function runExport(kind) {
  switch (kind) {
    case 'yaml': exportYamlFile(); break
    case 'json': exportJsonFile(); break
    case 'md': exportMarkdownFile(); break
    case 'mermaid': exportMermaidFile(); break
    case 'svg': exportSVG(); break
    case 'png': exportPNG(2); break
    case 'share': copyShareLink(); break
    default: break
  }
}

async function toggleVisit() {
  const mod = await import('./visit.js')
  if (ui.visiting) mod.stopVisit(); else mod.startVisit()
  renderToolbar()
}
