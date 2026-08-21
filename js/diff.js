// ════════════════════════════════════════════════════════════
//  diff.js: what changed between two documents. Pure over two models,
//  plus the marks the renderers paint: per-seat tags (new, moved from X,
//  +20), ghost seats for people who left a group, and added/changed
//  groups. People and groups match by id, which is the slug of the name,
//  so two documents written independently still line up.
// ════════════════════════════════════════════════════════════

import { state, ui } from './state.js'
import { normalizeDoc } from './schema.js'

const modelCache = new WeakMap()
/** Normalize a history entry's raw tree once. */
export function versionModel(entry) {
  if (!entry) return null
  if (!modelCache.has(entry)) modelCache.set(entry, normalizeDoc(entry.doc).model)
  return modelCache.get(entry)
}

/** The baseline the current document is compared against, or null. */
export function baseModel() {
  const c = ui.compare
  if (!c) return null
  if (c.kind === 'version') return versionModel(state.history[c.index]) || null
  if (c.kind === 'external') return c.model || null
  return null
}

export function baseLabel() {
  const c = ui.compare
  if (!c) return ''
  if (c.kind === 'version') { const h = state.history[c.index]; return h ? `v${c.index + 1}${h.date ? ' · ' + h.date : ''}${h.label ? ' · ' + h.label : ''}` : '' }
  return c.label || 'pasted document'
}

/** Recompute ui.diff / ui.marks from the current document. Call before rendering. */
export function refreshDiff() {
  const a = baseModel()
  if (!a) { ui.diff = null; ui.marks = null; return }
  ui.diff = diffModels(a, state)
  ui.marks = marksFor(ui.diff, a, state)
}

const memberMap = m => {
  const out = new Map()
  for (const g of Object.values(m.groups)) for (const x of g.members) out.set(`${g.id}:${x.person}`, x.pct)
  return out
}
const linkKey = l => [l.from, l.to].sort().join('--')
const same = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null)

export function diffModels(a, b) {
  const d = {
    people: { added: [], removed: [], changed: [] },
    groups: { added: [], removed: [], changed: [] },
    memberships: [],   // { person, group, kind: 'joined'|'left'|'share', from, to }
    moves: [],         // { person, from, to, pct }  (a left + a joined for the same person)
    links: { added: [], removed: [] },
    layout: [],        // group ids whose rect changed
    summary: { total: 0 },
  }
  for (const id of Object.keys(b.people)) if (!a.people[id]) d.people.added.push(id)
  for (const id of Object.keys(a.people)) if (!b.people[id]) d.people.removed.push(id)
  for (const id of Object.keys(b.people)) {
    const pa = a.people[id], pb = b.people[id]; if (!pa) continue
    const fields = {}
    for (const k of ['name', 'location', 'role']) if (pa[k] !== pb[k]) fields[k] = [pa[k], pb[k]]
    if (Object.keys(fields).length) d.people.changed.push({ id, fields })
  }
  for (const id of Object.keys(b.groups)) if (!a.groups[id]) d.groups.added.push(id)
  for (const id of Object.keys(a.groups)) if (!b.groups[id]) d.groups.removed.push(id)
  for (const id of Object.keys(b.groups)) {
    const ga = a.groups[id], gb = b.groups[id]; if (!ga) continue
    const fields = {}
    if (ga.name !== gb.name) fields.name = [ga.name, gb.name]
    if (ga.parent !== gb.parent) fields.parent = [ga.parent, gb.parent]
    if (ga.capacity !== gb.capacity) fields.capacity = [ga.capacity, gb.capacity]
    if (!same(ga.owns, gb.owns)) fields.owns = [ga.owns.join(', '), gb.owns.join(', ')]
    if (!same([...ga.spans].sort(), [...gb.spans].sort())) fields.spans = [ga.spans.join(', '), gb.spans.join(', ')]
    if (Object.keys(fields).length) d.groups.changed.push({ id, fields })
    if (!same(ga.layout, gb.layout)) d.layout.push(id)
  }
  const ma = memberMap(a), mb = memberMap(b)
  for (const [k, pct] of mb) {
    const [group, person] = k.split(':')
    if (!ma.has(k)) d.memberships.push({ person, group, kind: 'joined', to: pct })
    else if (ma.get(k) !== pct) d.memberships.push({ person, group, kind: 'share', from: ma.get(k), to: pct })
  }
  for (const [k, pct] of ma) {
    const [group, person] = k.split(':')
    if (!mb.has(k)) d.memberships.push({ person, group, kind: 'left', from: pct })
  }
  // a person who left exactly one group and joined exactly one moved
  const byPerson = new Map()
  for (const m of d.memberships) {
    if (!byPerson.has(m.person)) byPerson.set(m.person, { left: [], joined: [] })
    if (m.kind === 'left') byPerson.get(m.person).left.push(m)
    if (m.kind === 'joined') byPerson.get(m.person).joined.push(m)
  }
  for (const [person, { left, joined }] of byPerson) {
    if (left.length === 1 && joined.length === 1) {
      d.moves.push({ person, from: left[0].group, to: joined[0].group, pct: joined[0].to, fromPct: left[0].from })
      left[0].moved = true; joined[0].moved = true
    }
  }
  const la = new Set(a.links.map(linkKey)), lb = new Set(b.links.map(linkKey))
  for (const l of b.links) if (!la.has(linkKey(l))) d.links.added.push(l)
  for (const l of a.links) if (!lb.has(linkKey(l))) d.links.removed.push(l)
  d.summary = {
    people: d.people.added.length + d.people.removed.length + d.people.changed.length,
    groups: d.groups.added.length + d.groups.removed.length + d.groups.changed.length,
    moves: d.moves.length,
    shares: d.memberships.filter(m => m.kind === 'share').length,
    joined: d.memberships.filter(m => m.kind === 'joined' && !m.moved).length,
    left: d.memberships.filter(m => m.kind === 'left' && !m.moved).length,
    links: d.links.added.length + d.links.removed.length,
    layout: d.layout.length,
  }
  d.summary.total = Object.values(d.summary).reduce((s, n) => s + n, 0)
  return d
}

/** Board overlay: seat marks, ghost seats per group, group marks. */
export function marksFor(diff, a, b) {
  const seats = new Map(), ghosts = new Map(), groups = new Map()
  const nameOf = id => b.people[id]?.name || a.people[id]?.name || id
  const gname = id => b.groups[id]?.name || a.groups[id]?.name || id
  for (const m of diff.moves) {
    seats.set(`${m.to}:${m.person}`, { kind: 'moved', text: `from ${gname(m.from)}`, from: m.from })
    addGhost(ghosts, m.from, { person: m.person, name: nameOf(m.person), pct: m.fromPct, text: `to ${gname(m.to)}`, kind: 'moved' })
  }
  for (const m of diff.memberships) {
    if (m.moved) continue
    if (m.kind === 'joined') seats.set(`${m.group}:${m.person}`, { kind: 'joined', text: diff.people.added.includes(m.person) ? 'new' : 'joined' })
    if (m.kind === 'share') seats.set(`${m.group}:${m.person}`, { kind: 'share', text: `${m.to > m.from ? '+' : ''}${m.to - m.from}`, delta: m.to - m.from })
    if (m.kind === 'left') addGhost(ghosts, m.group, { person: m.person, name: nameOf(m.person), pct: m.from, text: diff.people.removed.includes(m.person) ? 'gone' : 'left', kind: 'left' })
  }
  for (const id of diff.groups.added) groups.set(id, 'added')
  for (const c of diff.groups.changed) if (!groups.has(c.id)) groups.set(c.id, 'changed')
  return { seats, ghosts, groups }
}
function addGhost(map, group, ghost) { if (!map.has(group)) map.set(group, []); map.get(group).push(ghost) }
