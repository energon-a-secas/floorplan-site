// ════════════════════════════════════════════════════════════
//  workspace-adapter.js: Floorplan's model <-> the Neorgon Workspace.
//  Pure (no DOM), so test/workspace-adapter.test.mjs runs it in Node.
//
//  teamToDoc(ws)            a normalized workspace -> a Floorplan document
//                           tree, which the caller runs through normalizeDoc
//                           like every other entry point
//  docToPayload(model, ws)  the Floorplan model -> a save payload
//                           { v, people, teams } for the Workspace page
//
//  Ids: a person or group the workspace already holds goes back under that
//  id, so a second save adds nobody. One Floorplan made itself goes as
//  `floorplan-<id>` (the kit README's rule), so two tools' ids never collide.
//  Every value leaves through the kit's validators; the page normalizes the
//  payload again anyway, since a link is untrusted wherever it came from.
//
//  Lossless round trip: using the team and saving it back unedited changes
//  nothing. Names keep the kit's 120 characters; a tag Floorplan lowercased goes
//  back in the workspace's spelling; a group colour Floorplan only filled in
//  (the palette slot, or a parent's) is not sent for a team that has none.
// ════════════════════════════════════════════════════════════

import * as W from './neorgon-workspace-core.js'
import { colorAt } from './utils.js'

export const PREFIX = 'floorplan-'
export const TEAM_TITLE = 'My team'

const NAME_MAX = 120  // the kit's cap: a shorter one would cut a name and the save would write it back cut
const ID_MAX = 48     // the kit's id length

/** A workspace (already normalized by the kit) as a Floorplan document tree. */
export function teamToDoc(ws, { title = TEAM_TITLE } = {}) {
  const { ws: clean } = W.normalizeWorkspace(ws)
  const byId = new Map(clean.people.map(p => [p.id, p]))
  const people = clean.people.map(p => {
    const out = { id: p.id, name: W.str(p.name, NAME_MAX) || p.id }
    if (p.title) out.role = p.title
    if (p.location) out.location = p.location
    if (p.tz) out.tz = p.tz
    if (p.tags && p.tags.length) out.tags = p.tags.slice()
    if (p.color) out.color = p.color
    if (p.avatar) out.avatar = p.avatar
    return out
  })
  const groups = clean.teams.map(t => {
    const out = { id: t.id, name: W.str(t.name, NAME_MAX) || t.id }
    if (t.color) out.color = t.color
    const lead = t.lead ? byId.get(t.lead) : null
    if (lead) out.notes = `Lead: ${lead.name}`
    out.members = t.members.filter(m => byId.has(m.person)).map(m => (m.pct === 100 ? m.person : { person: m.person, pct: m.pct }))
    return out
  })
  return { title, people, groups }
}

/** True when the document holds nothing a "Use my team" would throw away. */
export function isBlank(model) {
  return !Object.keys(model.people || {}).length && !Object.keys(model.groups || {}).length
}

// The id to send: the workspace's own when it holds one, else Floorplan's, prefixed.
// Past 48 characters the tail becomes a hash of the whole id, so two long ids
// that differ only at the end stay two people.
function idFor(id, known) {
  const own = W.slug(id)
  if (own && known.has(own)) return own
  const full = own.startsWith(PREFIX) ? own : PREFIX + own   // both parts are slugs already
  if (full.length <= ID_MAX) return full
  const tail = '-' + W.hashString(own).toString(36)
  return full.slice(0, ID_MAX - tail.length).replace(/-+$/, '') + tail
}

// A tag list Floorplan lowercased goes back in the workspace's spelling.
function tagsFor(tags, stored) {
  const theirs = Array.isArray(stored) ? stored : []
  if (theirs.length && JSON.stringify(tags) === JSON.stringify([...new Set(theirs.map(t => t.toLowerCase()))])) return theirs.slice()
  const spelling = new Map(theirs.map(t => [t.toLowerCase(), t]))
  return tags.map(t => spelling.get(t.toLowerCase()) || t)
}

// The colour normalizeDoc gives a group that has none: its palette slot at the
// top level, its parent's below.
function filledColor(model, g, tops) {
  if (g.parent == null) { const i = tops.indexOf(g); return i >= 0 ? colorAt(i) : '' }
  return model.groups[g.parent]?.color || colorAt(0)
}

/** The Floorplan model as a save payload. `ws` is the workspace the tool holds now (or null). */
export function docToPayload(model, ws = null) {
  const stored = W.isMap(ws) ? W.normalizeWorkspace(ws).ws : null
  const storedPeople = new Map(stored ? stored.people.map(p => [p.id, p]) : [])
  const storedTeams = new Map(stored ? stored.teams.map(t => [t.id, t]) : [])
  const peopleIds = new Set(storedPeople.keys())
  const teamIds = new Set(storedTeams.keys())
  const ids = new Map()
  const people = []
  for (const p of Object.values(model.people || {})) {
    const name = W.str(p.name, 120)
    if (!W.visible(name)) continue
    const id = idFor(p.id, peopleIds)
    ids.set(p.id, id)
    const out = { id, name }
    const title = W.str(p.role, 120); if (title) out.title = title
    const location = W.str(p.location, 120); if (location) out.location = location
    const tz = W.zone(String(p.tz || '')); if (tz) out.tz = tz
    const color = W.color(p.color); if (color) out.color = color
    const avatar = p.avatar && W.avatar(p.avatar.code); if (avatar) out.avatar = avatar
    const tags = tagsFor((Array.isArray(p.tags) ? p.tags : []).map(t => W.str(t, 40)).filter(Boolean), storedPeople.get(id)?.tags).slice(0, W.LIMITS.tags)
    if (tags.length) out.tags = tags
    people.push(out)
  }
  const groups = Object.values(model.groups || {}).sort((a, b) => a.order - b.order)
  const tops = Object.values(model.groups || {}).filter(g => g.parent == null)
  const teams = []
  for (const g of groups) {
    const name = W.str(g.name, 120)
    if (!W.visible(name)) continue
    const out = { id: idFor(g.id, teamIds), name }
    const was = storedTeams.get(out.id)
    const color = W.color(g.color)
    if (color && !(was && !was.color && color === W.color(filledColor(model, g, tops)))) out.color = color
    out.members = (g.members || []).filter(m => ids.has(m.person)).map(m => ({ person: ids.get(m.person), pct: Math.min(100, Math.max(1, Math.round(Number(m.pct) || 100))) }))
    teams.push(out)
  }
  return { v: 1, people: people.slice(0, W.LIMITS.people), teams: teams.slice(0, W.LIMITS.teams) }
}

/** Core hours, in hours from midnight, from the visitor's working hours ([startMin, endMin]); 9 to 17 otherwise. */
export function coreFromPrefs(prefs) {
  const h = W.isMap(prefs) ? W.hours(prefs.h) : null
  return h ? { start: h[0] / 60, end: h[1] / 60 } : { start: 9, end: 17 }
}

/** The kit's colour and initials for a person: the same face in every tool. */
export function faceOf(person) {
  const color = W.colorFor({ id: person.id, name: person.name, color: W.color(person.color) })
  return { color, ink: W.inkOn(color), initials: W.initials(person.name) }
}
