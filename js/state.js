// ════════════════════════════════════════════════════════════
//  state.js: the live model (one object, mutated in place), the transient
//  ui object (never persisted), mutations, localStorage and undo/redo.
//
//  Persistence saves the document TREE (what the YAML would say), not the
//  internal map shape, and reloads it through normalizeDoc. One format on
//  disk, one validator in front of everything.
//
//  Undo is a 40-deep stack of model snapshots. resetTo() never touches the
//  history, so "Clear" and "Load example" are undoable (loadout-site lost
//  the stack on reset; this does not).
// ════════════════════════════════════════════════════════════

import { emptyModel, normalizeDoc, modelToDoc, MODES } from './schema.js'
import { debounce, slug, colorAt } from './utils.js'

export const STORAGE_KEY = 'floorplan-v1'

export const state = emptyModel()

// Transient UI state; never saved, never in a snapshot.
export const ui = {
  selection: null,    // { type: 'person' | 'group', id }
  picked: null,       // keyboard carry: { person, from }
  yamlOpen: false,
  yamlDirty: false,   // textarea edited but not applied
  yamlText: '',
  drawerOpen: false,
  errors: [],
  warnings: [],
  scale: 1,
  avatars: true,
  visiting: false,
}

// ── Replace / clear ──────────────────────────────────────────
export function resetTo(model) {
  state.meta = model.meta
  state.profiles = model.profiles
  state.people = model.people
  state.groups = model.groups
  state.links = model.links
}
export function clearAll() { resetTo(emptyModel()) }

// ── Lookups ──────────────────────────────────────────────────
const byOrder = (a, b) => a.order - b.order
export function allGroups() { return Object.values(state.groups).sort(byOrder) }
export function topGroups() { return allGroups().filter(g => g.kind === 'group' && g.parent === null) }
export function bands() { return allGroups().filter(g => g.kind === 'band') }
export function childrenOf(id) { return allGroups().filter(g => g.parent === id) }
export function descendantsOf(id) {
  const out = []
  const walk = pid => childrenOf(pid).forEach(c => { out.push(c); walk(c.id) })
  walk(id)
  return out
}
export function membershipsOf(personId) {
  const out = []
  for (const g of allGroups()) {
    const m = g.members.find(x => x.person === personId)
    if (m) out.push({ group: g, pct: m.pct })
  }
  return out
}
export function nextOrder() { return Object.values(state.groups).reduce((m, g) => Math.max(m, g.order), -1) + 1 }

function uniqueKey(base, taken) {
  let id = slug(base), n = 2
  const root = id
  while (taken[id]) id = `${root}-${n++}`
  return id
}

// ── People ───────────────────────────────────────────────────
export function addPerson({ name, location = '', role = '' }) {
  const clean = String(name ?? '').trim().slice(0, 60)
  if (!clean) return null
  const id = uniqueKey(clean, state.people)
  const p = { id, name: clean, location: String(location).trim(), role: String(role).trim(), color: '', notes: '', extends: [] }
  state.people[id] = p
  return p
}
export function updatePerson(id, patch) {
  const p = state.people[id]; if (!p) return
  for (const k of ['name', 'location', 'role', 'color', 'notes']) if (k in patch) p[k] = String(patch[k] ?? '')
}
export function removePerson(id) {
  delete state.people[id]
  for (const g of Object.values(state.groups)) g.members = g.members.filter(m => m.person !== id)
  if (ui.selection?.type === 'person' && ui.selection.id === id) ui.selection = null
}

// ── Groups ───────────────────────────────────────────────────
export function addGroup({ name, parent = null, kind = 'group', spans = [] }) {
  const clean = String(name ?? '').trim().slice(0, 60)
  if (!clean) return null
  const id = uniqueKey(clean, state.groups)
  const tops = Object.values(state.groups).filter(g => g.parent === null).length
  const color = parent ? (state.groups[parent]?.color || colorAt(0)) : colorAt(tops)
  const g = { id, kind, name: clean, parent: kind === 'band' ? null : parent, spans: kind === 'band' ? [...spans] : [],
    color, notes: '', capacity: null, owns: [], extends: [], order: nextOrder(), members: [], layout: null }
  state.groups[id] = g
  return g
}
export function updateGroup(id, patch) {
  const g = state.groups[id]; if (!g) return
  for (const k of ['name', 'color', 'notes']) if (k in patch) g[k] = String(patch[k] ?? '')
  if ('capacity' in patch) { const n = Number(patch.capacity); g.capacity = Number.isFinite(n) && n >= 0 ? Math.round(n) : null }
  if ('owns' in patch) g.owns = Array.isArray(patch.owns) ? patch.owns.map(String).filter(Boolean) : []
  if ('spans' in patch && g.kind === 'band') g.spans = Array.isArray(patch.spans) ? patch.spans.filter(x => state.groups[x]) : []
}
export function removeGroup(id) {
  const victims = [id, ...descendantsOf(id).map(g => g.id)]
  for (const v of victims) delete state.groups[v]
  for (const g of Object.values(state.groups)) g.spans = g.spans.filter(s => !victims.includes(s))
  state.links = state.links.filter(l => !victims.includes(l.from) && !victims.includes(l.to))
  if (ui.selection?.type === 'group' && victims.includes(ui.selection.id)) ui.selection = null
}
/** Move a group one slot earlier/later among its siblings (dir = -1 | 1). */
export function reorderGroup(id, dir) {
  const g = state.groups[id]; if (!g) return
  const sibs = allGroups().filter(x => x.kind === g.kind && x.parent === g.parent)
  const i = sibs.indexOf(g), j = i + dir
  if (j < 0 || j >= sibs.length) return
  const tmp = sibs[i].order; sibs[i].order = sibs[j].order; sibs[j].order = tmp
}

// ── Memberships ──────────────────────────────────────────────
const pctOf = v => Math.min(100, Math.max(1, Math.round(Number(v) || 100)))
export function setMembership(groupId, personId, pct = 100) {
  const g = state.groups[groupId]; if (!g || !state.people[personId]) return false
  const m = g.members.find(x => x.person === personId)
  if (m) m.pct = pctOf(pct)
  else g.members.push({ person: personId, pct: pctOf(pct) })
  return true
}
export function removeMembership(groupId, personId) {
  const g = state.groups[groupId]; if (!g) return
  g.members = g.members.filter(x => x.person !== personId)
}
/** Move keeps the pct; landing on a group that already has the person merges (capped at 100). */
export function moveMember(fromId, toId, personId) {
  if (fromId === toId) return false
  const from = state.groups[fromId], to = state.groups[toId]
  if (!from || !to) return false
  const m = from.members.find(x => x.person === personId); if (!m) return false
  const existing = to.members.find(x => x.person === personId)
  if (existing) existing.pct = Math.min(100, existing.pct + m.pct)
  else to.members.push({ person: personId, pct: m.pct })
  from.members = from.members.filter(x => x.person !== personId)
  return true
}
/** Split evenly: the source keeps floor(p/2), the target gets the rest (added to any existing share). */
export function splitMember(fromId, toId, personId) {
  if (fromId === toId) return false
  const from = state.groups[fromId], to = state.groups[toId]
  if (!from || !to) return false
  const m = from.members.find(x => x.person === personId); if (!m) return false
  if (m.pct < 2) return moveMember(fromId, toId, personId)
  const keep = Math.floor(m.pct / 2), give = m.pct - keep
  m.pct = keep
  const existing = to.members.find(x => x.person === personId)
  if (existing) existing.pct = Math.min(100, existing.pct + give)
  else to.members.push({ person: personId, pct: give })
  return true
}

// ── Layout, links, mode ──────────────────────────────────────
export function setLayout(groupId, rect) {
  const g = state.groups[groupId]; if (!g) return
  g.layout = rect ? { x: Math.max(0, Math.round(rect.x)), y: Math.max(0, Math.round(rect.y)), w: Math.max(2, Math.round(rect.w)), h: Math.max(2, Math.round(rect.h)) } : null
}
export function clearLayouts() { for (const g of Object.values(state.groups)) g.layout = null }
export function setMode(mode) { if (MODES.includes(mode)) state.meta.mode = mode }
export function addLink(from, to, label = '') {
  if (from === to || !state.groups[from] || !state.groups[to]) return null
  const dup = state.links.find(l => (l.from === from && l.to === to) || (l.from === to && l.to === from))
  if (dup) { if (label) dup.label = label; return dup }
  const l = { id: `${from}--${to}`, from, to, label, kind: 'auto' }
  state.links.push(l)
  return l
}
export function removeLink(id) { state.links = state.links.filter(l => l.id !== id) }

// ── Persistence ──────────────────────────────────────────────
export function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, doc: modelToDoc(state).doc, savedAt: Date.now() }))
  } catch { /* quota or private mode: the session still works */ }
}
export const debouncedSave = debounce(saveState, 300)

/** Restore the last session. Returns true when something was loaded. */
export function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    const data = JSON.parse(raw)
    const doc = data?.doc ?? data
    const { model, errors } = normalizeDoc(doc)
    if (errors.length) ui.warnings = errors
    resetTo(model)
    return Object.keys(model.people).length + Object.keys(model.groups).length > 0
  } catch { return false }
}

// ── Undo / redo ──────────────────────────────────────────────
const past = [], future = []
const MAX_HISTORY = 40
const pack = () => JSON.stringify({ meta: state.meta, profiles: state.profiles, people: state.people, groups: state.groups, links: state.links })

export function snapshot() {
  past.push(pack())
  if (past.length > MAX_HISTORY) past.shift()
  future.length = 0
}
export function undo() {
  if (!past.length) return false
  future.push(pack())
  resetTo(JSON.parse(past.pop()))
  return true
}
export function redo() {
  if (!future.length) return false
  past.push(pack())
  resetTo(JSON.parse(future.pop()))
  return true
}
export const canUndo = () => past.length > 0
export const canRedo = () => future.length > 0
