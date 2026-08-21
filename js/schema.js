// ════════════════════════════════════════════════════════════
//  schema.js: the document model and the YAML shape it round-trips to.
//
//  normalizeDoc(raw)  parsed YAML/JSON -> { model, errors, warnings }
//  modelToDoc(model)  model -> plain tree object ready for yaml dump
//
//  Reuse is gitlabform-style: a top-level `profiles:` map holds partial
//  group or person definitions, and `extends: name | [names]` on a group
//  or person deep-merges them (scalars override, members/owns concatenate,
//  later pct wins). Every entry point (localStorage, #d=, ?src=, file,
//  outline paste) goes through normalizeDoc, so the renderers never see a
//  half-formed document.
// ════════════════════════════════════════════════════════════

import { slug, isHex, colorAt } from './utils.js'

export const SCHEMA_VERSION = 1
export const MODES = ['diagram', 'building']
export const DEFAULT_CELL = 48
export const DISPLAY_DEFAULTS = { align: 'start', shares: 'bars', placeholder: 'desk', avatars: 'pixel', locations: true, sort: 'manual' }
export const DISPLAY_OPTIONS = { align: ['start', 'center'], shares: ['bars', 'badges', 'hidden'], placeholder: ['desk', 'cat', 'dog', 'none'], avatars: ['pixel', 'initials'], sort: ['manual', 'name', 'share'] }
const AVATAR_KEYS = ['preset', 'kind', 'hair', 'hairColor', 'skin', 'coat', 'glasses', 'beard', 'item', 'shirt']
const AVATAR_KINDS = ['person', 'cat', 'dog', 'robot']

export function emptyModel() {
  return {
    meta: { title: '', notes: '', mode: 'diagram', cell: DEFAULT_CELL, display: { ...DISPLAY_DEFAULTS } },
    profiles: {},
    people: {},     // id -> { id, name, location, role, color, notes, extends: [] }
    groups: {},     // id -> { id, kind, name, parent, spans, color, notes, capacity, owns, extends, order, members, layout }
    links: [],      // { id, from, to, label, kind }
    history: [],    // { id, date, label, doc }  dated snapshots of the whole document (minus history)
  }
}

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const asList = v => (v == null ? [] : Array.isArray(v) ? v : [v])
const str = v => (v == null ? '' : String(v))

// ── Member refs ──────────────────────────────────────────────
// Accepted forms: "maya-k" | "Maya K" | { person|id|name: x, pct } | { "maya-k": 50 }
export function memberRef(m) {
  if (typeof m === 'string' || typeof m === 'number') return { ref: str(m).trim(), pct: null }
  if (!isObj(m)) return null
  const key = m.person ?? m.id ?? m.name
  if (key != null) return { ref: str(key).trim(), pct: m.pct ?? m.percent ?? null }
  const entries = Object.entries(m)
  if (entries.length === 1) return { ref: str(entries[0][0]).trim(), pct: entries[0][1] }
  return null
}
export const refKey = ref => slug(ref)

function clampPct(v) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return 100
  return Math.min(100, Math.max(1, n))
}

// Merge two partial definitions. `members` and `owns` concatenate (dedupe by
// ref, later pct wins); everything else overrides. `extends` never copies.
export function mergeDef(base, over) {
  const out = { ...base }
  for (const [k, v] of Object.entries(over || {})) {
    if (k === 'extends') continue
    if (k === 'members') {
      const seen = new Map()
      for (const m of [...asList(base.members), ...asList(v)]) {
        const r = memberRef(m); if (!r) continue
        const key = refKey(r.ref)
        const prev = seen.get(key)
        seen.set(key, { ref: prev?.ref ?? r.ref, pct: r.pct ?? prev?.pct ?? null })
      }
      out.members = [...seen.values()].map(r => (r.pct == null ? r.ref : { person: r.ref, pct: r.pct }))
    } else if (k === 'owns') {
      out.owns = [...new Set([...asList(base.owns), ...asList(v)].map(str))]
    } else if (k === 'needs' || k === 'tags') {
      out[k] = [...new Set([...tagList(base[k]), ...tagList(v)])]
    } else {
      out[k] = v
    }
  }
  return out
}

// Resolve a chain of profile names into one merged partial. Profiles may
// extend profiles; a visiting set catches cycles.
export function resolveProfiles(profiles, names, errors = [], ctx = '') {
  const list = asList(names).map(str).filter(Boolean)
  let acc = {}
  const visiting = []
  const walk = name => {
    if (visiting.includes(name)) {
      errors.push(`Profile cycle: ${[...visiting, name].join(' -> ')}`)
      return {}
    }
    const p = profiles[name]
    if (!isObj(p)) { errors.push(`${ctx}extends unknown profile "${name}"`); return {} }
    visiting.push(name)
    let merged = {}
    for (const parent of asList(p.extends).map(str)) merged = mergeDef(merged, walk(parent))
    merged = mergeDef(merged, p)
    visiting.pop()
    return merged
  }
  for (const n of list) acc = mergeDef(acc, walk(n))
  return acc
}

function readLayout(v, warnings, ctx) {
  if (v == null) return null
  if (!isObj(v)) { warnings.push(`${ctx}layout must be { x, y, w, h }`); return null }
  const x = Number(v.x ?? 0), y = Number(v.y ?? 0), w = Number(v.w ?? 4), h = Number(v.h ?? 4)
  if (![x, y, w, h].every(Number.isFinite) || w < 1 || h < 1 || x < 0 || y < 0) {
    warnings.push(`${ctx}layout ignored (needs x,y >= 0 and w,h >= 1)`)
    return null
  }
  return { x, y, w, h }
}

/** tags / needs: list or comma string -> lowercase, trimmed, unique */
export function tagList(v) {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []
  return [...new Set(raw.map(x => str(x).trim().toLowerCase()).filter(Boolean))]
}

/** avatar: "cat" | "preset-id" | { kind, hair, hairColor, skin, coat, glasses, beard, item, shirt, preset } -> normalized object or null */
export function readAvatar(v) {
  if (v == null) return null
  if (typeof v === 'string') { const t = v.trim(); if (!t) return null; return AVATAR_KINDS.includes(t) ? { kind: t } : { preset: t } }
  if (!isObj(v)) return null
  const out = {}
  for (const k of AVATAR_KEYS) if (v[k] !== undefined && v[k] !== null && v[k] !== '') out[k] = typeof v[k] === 'boolean' || typeof v[k] === 'number' ? v[k] : str(v[k])
  if (out.kind && !AVATAR_KINDS.includes(out.kind)) delete out.kind
  return Object.keys(out).length ? out : null
}

function uniqueId(base, taken) {
  let id = base || 'item', n = 2
  while (taken.has(id)) id = `${base}-${n++}`
  taken.add(id)
  return id
}

// ── normalizeDoc ─────────────────────────────────────────────
export function normalizeDoc(raw) {
  const errors = [], warnings = []
  const model = emptyModel()
  if (!isObj(raw)) {
    errors.push('The document must be a YAML mapping (title, people, groups, ...)')
    return { model, errors, warnings }
  }

  // meta
  model.meta.title = str(raw.title).trim().slice(0, 80)
  model.meta.notes = str(raw.notes)
  model.meta.mode = MODES.includes(raw.mode) ? raw.mode : 'diagram'
  const cell = Number(raw.cell)
  model.meta.cell = Number.isFinite(cell) ? Math.min(96, Math.max(24, Math.round(cell))) : DEFAULT_CELL
  if (isObj(raw.display)) {
    for (const [k, opts] of Object.entries(DISPLAY_OPTIONS)) if (opts.includes(raw.display[k])) model.meta.display[k] = raw.display[k]
    if (typeof raw.display.locations === 'boolean') model.meta.display.locations = raw.display.locations
  }

  // profiles (kept verbatim)
  if (raw.profiles != null && !isObj(raw.profiles)) errors.push('profiles must be a mapping of name -> partial definition')
  for (const [name, p] of Object.entries(isObj(raw.profiles) ? raw.profiles : {})) {
    if (!isObj(p)) { errors.push(`Profile "${name}" must be a mapping`); continue }
    if (p.groups) errors.push(`Profile "${name}": nested groups inside a profile are not supported; put them on the group itself`)
    model.profiles[name] = p
  }

  // people
  const personIds = new Set()
  const personList = asList(raw.people)
  if (raw.people != null && !Array.isArray(raw.people)) errors.push('people must be a list')
  personList.forEach((entry, i) => {
    const ctx = `people[${i}]: `
    let own = typeof entry === 'string' || typeof entry === 'number' ? { name: str(entry) } : entry
    if (!isObj(own)) { errors.push(`${ctx}must be a name or a mapping`); return }
    const ext = asList(own.extends).map(str)
    const merged = mergeDef(resolveProfiles(model.profiles, ext, errors, `Person ${str(own.name || own.id)}: `), own)
    const name = str(merged.name).trim()
    if (!name && !own.id) { errors.push(`${ctx}needs a name`); return }
    const id = uniqueId(slug(own.id ?? name), personIds)
    model.people[id] = {
      id, name: name || id,
      location: str(merged.location).trim(),
      role: str(merged.role).trim(),
      color: isHex(merged.color) ? merged.color : '',
      notes: str(merged.notes),
      avatar: readAvatar(merged.avatar),
      tz: str(merged.tz ?? merged.timezone).trim(),
      tags: tagList(merged.tags ?? merged.skills),
      extends: ext,
    }
  })

  // groups + bands (pass 1: shape, ids, extends; members/spans resolved in pass 2)
  const groupIds = new Set()
  const pending = []   // { group, rawMembers, rawSpans }
  let order = 0
  const addGroup = (entry, parent, kind, ctx) => {
    if (!isObj(entry)) { errors.push(`${ctx}must be a mapping with a name`); return }
    const ext = asList(entry.extends).map(str)
    const merged = mergeDef(resolveProfiles(model.profiles, ext, errors, `Group ${str(entry.name || entry.id)}: `), entry)
    const name = str(merged.name).trim()
    if (!name && !entry.id) { errors.push(`${ctx}needs a name`); return }
    const id = uniqueId(slug(entry.id ?? name), groupIds)
    const cap = merged.capacity == null ? null : Math.max(0, Math.round(Number(merged.capacity)) || 0)
    const g = {
      id, kind, name: name || id, parent, spans: [],
      color: isHex(merged.color) ? merged.color : '',
      notes: str(merged.notes),
      capacity: cap,
      owns: asList(merged.owns).map(str).filter(Boolean),
      needs: tagList(merged.needs ?? merged.skills),
      extends: ext,
      order: order++,
      members: [],
      layout: readLayout(merged.layout, warnings, `Group ${name}: `),
    }
    model.groups[id] = g
    pending.push({ group: g, rawMembers: asList(merged.members), rawSpans: asList(merged.spans) })
    if (kind === 'group') asList(entry.groups).forEach((c, i) => addGroup(c, id, 'group', `${ctx}groups[${i}]: `))
    else if (entry.groups) warnings.push(`Band ${name}: bands cannot hold sub-groups; ignored`)
  }
  if (raw.groups != null && !Array.isArray(raw.groups)) errors.push('groups must be a list')
  asList(raw.groups).forEach((g, i) => addGroup(g, null, 'group', `groups[${i}]: `))
  const bands = raw.bands ?? raw.shared
  if (bands != null && !Array.isArray(bands)) errors.push('bands must be a list')
  asList(bands).forEach((b, i) => addGroup(b, null, 'band', `bands[${i}]: `))

  // top-level layout map (alternative to inline layout)
  if (isObj(raw.layout)) {
    for (const [k, v] of Object.entries(raw.layout)) {
      const g = findGroup(model, k)
      if (!g) { warnings.push(`layout: unknown group "${k}"`); continue }
      if (!g.layout) g.layout = readLayout(v, warnings, `layout.${k}: `)
    }
  }

  // pass 2: members, spans
  for (const { group: g, rawMembers, rawSpans } of pending) {
    const seen = new Set()
    for (const m of rawMembers) {
      const r = memberRef(m)
      if (!r || !r.ref) { errors.push(`Group "${g.name}": unreadable member entry`); continue }
      let p = findPerson(model, r.ref)
      if (!p) {
        if (/^[a-z0-9][a-z0-9-]*$/.test(r.ref)) {
          errors.push(`Group "${g.name}": unknown person "${r.ref}" (add them under people:, or write a full name like "Maya K")`)
          continue
        }
        const id = uniqueId(slug(r.ref), personIds)
        p = model.people[id] = { id, name: r.ref, location: '', role: '', color: '', notes: '', avatar: null, tz: '', tags: [], extends: [] }
        warnings.push(`Group "${g.name}": created person "${r.ref}" from the members list`)
      }
      if (seen.has(p.id)) continue
      seen.add(p.id)
      g.members.push({ person: p.id, pct: r.pct == null ? 100 : clampPct(r.pct) })
    }
    if (g.kind === 'band') {
      for (const s of rawSpans) {
        const t = findGroup(model, str(s))
        if (!t) errors.push(`Band "${g.name}": spans unknown group "${str(s)}"`)
        else if (t.kind === 'band') errors.push(`Band "${g.name}": cannot span another band ("${t.name}")`)
        else if (!g.spans.includes(t.id)) g.spans.push(t.id)
      }
      if (!g.spans.length) warnings.push(`Band "${g.name}" spans nothing; it renders at full width`)
    }
  }

  // links
  if (raw.links != null && !Array.isArray(raw.links)) errors.push('links must be a list')
  asList(raw.links).forEach((l, i) => {
    let from, to, label = '', kind = 'auto'
    if (Array.isArray(l)) { [from, to, label] = l.map(str) }
    else if (isObj(l)) { from = str(l.from); to = str(l.to); label = str(l.label); kind = l.kind || 'auto' }
    else if (typeof l === 'string' && l.includes('->')) { [from, to] = l.split('->').map(s => s.trim()) }
    const a = findGroup(model, from), b = findGroup(model, to)
    if (!a || !b) { errors.push(`links[${i}]: unknown group "${!a ? from : to}"`); return }
    if (a.id === b.id) { warnings.push(`links[${i}]: ignored (links "${a.name}" to itself)`); return }
    model.links.push({ id: `${a.id}--${b.id}`, from: a.id, to: b.id, label: label.trim(), kind: ['door', 'corridor'].includes(kind) ? kind : 'auto' })
  })

  // history: dated snapshots, kept as raw trees and normalized only when viewed
  if (raw.history != null && !Array.isArray(raw.history)) errors.push('history must be a list of { date, label, doc }')
  asList(raw.history).forEach((h, i) => {
    if (!isObj(h) || !isObj(h.doc)) { warnings.push(`history[${i}]: skipped (needs a doc mapping)`); return }
    const doc = { ...h.doc }; delete doc.history
    model.history.push({ id: `v${i + 1}`, date: str(h.date).slice(0, 10), label: str(h.label).trim().slice(0, 60), doc })
  })

  // default colours: top-level groups and bands cycle the palette
  let ci = 0
  for (const g of Object.values(model.groups)) {
    if (g.parent === null) { if (!g.color) g.color = colorAt(ci); ci++ }
  }
  for (const g of Object.values(model.groups)) {
    if (g.parent !== null && !g.color) g.color = model.groups[g.parent]?.color || colorAt(0)
  }

  return { model, errors, warnings }
}

// ── Lookups ──────────────────────────────────────────────────
export function findPerson(model, ref) {
  const r = str(ref).trim(); if (!r) return null
  if (model.people[r]) return model.people[r]
  const s = slug(r)
  if (model.people[s]) return model.people[s]
  const low = r.toLowerCase()
  return Object.values(model.people).find(p => p.name.toLowerCase() === low) || null
}
export function findGroup(model, ref) {
  const r = str(ref).trim(); if (!r) return null
  if (model.groups[r]) return model.groups[r]
  const s = slug(r)
  if (model.groups[s]) return model.groups[s]
  const low = r.toLowerCase()
  return Object.values(model.groups).find(g => g.name.toLowerCase() === low) || null
}

// ── modelToDoc: rebuild the YAML tree, keeping `extends` intact ───────────
// For a node with extends we emit only what differs from its resolved profile
// base. The one lossy case (a base-provided member or owns entry removed by a
// visual edit) flattens that node: extends is dropped and it is emitted in full,
// and the caller is told via `flattened`.
export function modelToDoc(model) {
  const flattened = []
  const doc = {}
  if (model.meta.title) doc.title = model.meta.title
  if (model.meta.notes) doc.notes = model.meta.notes
  doc.mode = model.meta.mode
  if (model.meta.cell !== DEFAULT_CELL) doc.cell = model.meta.cell
  const disp = {}
  for (const [k, dv] of Object.entries(DISPLAY_DEFAULTS)) if (model.meta.display?.[k] !== undefined && model.meta.display[k] !== dv) disp[k] = model.meta.display[k]
  if (Object.keys(disp).length) doc.display = disp
  if (Object.keys(model.profiles).length) doc.profiles = structuredClone(model.profiles)

  doc.people = Object.values(model.people).map(p => personToDoc(model, p))

  const groups = Object.values(model.groups).sort((a, b) => a.order - b.order)
  doc.groups = groups.filter(g => g.kind === 'group' && g.parent === null).map(g => groupToDoc(model, g, groups, flattened))
  const bands = groups.filter(g => g.kind === 'band')
  if (bands.length) doc.bands = bands.map(g => groupToDoc(model, g, groups, flattened))
  if (model.links.length) {
    doc.links = model.links.map(l => {
      const o = { from: l.from, to: l.to }
      if (l.label) o.label = l.label
      if (l.kind !== 'auto') o.kind = l.kind
      return o
    })
  }
  if (model.history?.length) doc.history = model.history.map(h => ({ date: h.date, label: h.label, doc: structuredClone(h.doc) }))
  return { doc, flattened }
}

function personToDoc(model, p) {
  const base = p.extends.length ? resolveProfiles(model.profiles, p.extends) : {}
  const o = {}
  if (p.id !== slug(p.name)) o.id = p.id
  o.name = p.name
  if (p.extends.length) o.extends = p.extends.length === 1 ? p.extends[0] : [...p.extends]
  for (const k of ['location', 'role', 'color', 'notes', 'tz']) {
    if (p[k] && p[k] !== str(base[k])) o[k] = p[k]
  }
  if (p.tags?.length && JSON.stringify(p.tags) !== JSON.stringify(tagList(base.tags))) o.tags = [...p.tags]
  if (p.avatar && JSON.stringify(p.avatar) !== JSON.stringify(readAvatar(base.avatar))) {
    const keys = Object.keys(p.avatar)
    o.avatar = keys.length === 1 && (keys[0] === 'kind' || keys[0] === 'preset') ? p.avatar[keys[0]] : { ...p.avatar }
  }
  const keys = Object.keys(o)
  return keys.length === 1 && keys[0] === 'name' ? p.name : o
}

function groupToDoc(model, g, all, flattened) {
  let base = g.extends.length ? resolveProfiles(model.profiles, g.extends) : {}
  let ext = g.extends
  // lossy check: every base member / owns entry must still be present
  if (ext.length) {
    const baseRefs = asList(base.members).map(memberRef).filter(Boolean)
    const haveKeys = new Set(g.members.map(m => refKey(m.person)).concat(g.members.map(m => refKey(model.people[m.person]?.name || ''))))
    const lostMember = baseRefs.some(r => !haveKeys.has(refKey(r.ref)))
    const lostOwn = asList(base.owns).some(o => !g.owns.includes(str(o)))
    if (lostMember || lostOwn) { flattened.push(g.name); base = {}; ext = [] }
  }
  const o = {}
  if (g.id !== slug(g.name)) o.id = g.id
  o.name = g.name
  if (ext.length) o.extends = ext.length === 1 ? ext[0] : [...ext]
  if (g.kind === 'band' && g.spans.length) o.spans = [...g.spans]
  if (g.color && g.color !== str(base.color) && !(g.parent && g.color === model.groups[g.parent]?.color) && !isDefaultColor(model, g)) o.color = g.color
  if (g.notes && g.notes !== str(base.notes)) o.notes = g.notes
  if (g.capacity != null && g.capacity !== base.capacity) o.capacity = g.capacity
  const baseOwns = asList(base.owns).map(str)
  const owns = g.owns.filter(x => !baseOwns.includes(x))
  if (owns.length) o.owns = owns
  const baseNeeds = tagList(base.needs)
  const needs = (g.needs || []).filter(x => !baseNeeds.includes(x))
  if (needs.length) o.needs = needs
  if (g.layout && JSON.stringify(g.layout) !== JSON.stringify(base.layout || null)) o.layout = { ...g.layout }
  // members: emit those not provided (with the same pct) by the base
  const basePct = new Map()
  for (const m of asList(base.members)) { const r = memberRef(m); if (r) basePct.set(refKey(r.ref), r.pct == null ? 100 : clampPct(r.pct)) }
  const members = g.members.filter(m => {
    const p = model.people[m.person]
    const k1 = refKey(m.person), k2 = refKey(p?.name || '')
    const bp = basePct.has(k1) ? basePct.get(k1) : basePct.get(k2)
    return bp == null || bp !== m.pct
  }).map(m => (m.pct === 100 ? m.person : { person: m.person, pct: m.pct }))
  if (members.length) o.members = members
  const children = all.filter(c => c.parent === g.id)
  if (children.length) o.groups = children.map(c => groupToDoc(model, c, all, flattened))
  return o
}

// A top-level colour that equals the palette slot it would get by default is
// noise in the YAML; drop it so hand-written documents stay short.
function isDefaultColor(model, g) {
  if (g.parent !== null) return false
  const tops = Object.values(model.groups).filter(x => x.parent === null)
  const idx = tops.indexOf(g)
  return idx >= 0 && g.color === colorAt(idx)
}
