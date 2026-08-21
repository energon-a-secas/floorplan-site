// ════════════════════════════════════════════════════════════
//  allocation.js: the arithmetic behind the percentages, and the insight
//  list the drawer shows. Pure reads of state; nothing here mutates.
// ════════════════════════════════════════════════════════════

import { state, allGroups, childrenOf, descendantsOf } from './state.js'
import { fmtFte, plural } from './utils.js'
import { coreOverlap } from './timezones.js'

/** personId -> { total, count, parts: [{ group, pct }] } */
export function personTotals() {
  const out = new Map()
  for (const p of Object.values(state.people)) out.set(p.id, { total: 0, count: 0, parts: [] })
  for (const g of allGroups()) {
    for (const m of g.members) {
      const t = out.get(m.person); if (!t) continue
      t.total += m.pct; t.count++; t.parts.push({ group: g, pct: m.pct })
    }
  }
  return out
}

/** Band for a total: ok (100), under (<100), over (>100), none (unassigned). */
export function bandOf(t) {
  if (!t || t.count === 0) return 'none'
  if (t.total > 100) return 'over'
  if (t.total < 100) return 'under'
  return 'ok'
}

/** Headcount and FTE for a group: own members, and deep (with every descendant). */
export function groupStats(groupId) {
  const g = state.groups[groupId]
  if (!g) return { own: 0, deep: 0, fteOwn: 0, fteDeep: 0, capacity: null, vacant: 0, over: 0 }
  const own = g.members.length
  const fteOwn = g.members.reduce((s, m) => s + m.pct, 0) / 100
  const people = new Set(g.members.map(m => m.person))
  let fteDeep = fteOwn
  for (const d of descendantsOf(groupId)) {
    for (const m of d.members) { people.add(m.person); fteDeep += m.pct / 100 }
  }
  const cap = g.capacity
  const seated = people.size   // capacity counts every distinct person in the group and its sub-groups
  return {
    own, deep: seated, fteOwn, fteDeep, capacity: cap,
    vacant: cap != null ? Math.max(0, cap - seated) : 0,
    over: cap != null ? Math.max(0, seated - cap) : 0,
  }
}

export function statsLabel(groupId) {
  const s = groupStats(groupId)
  const n = s.deep
  if (!n) return 'empty'
  return `${plural(n, 'person', 'people')} · ${fmtFte(s.fteDeep)} FTE`
}

/**
 * Insights: what a manager should notice. `layout` is the result of
 * computeLayout() when the building view is live (for overlaps); pass null
 * in diagram mode.
 */
export function computeInsights(layout = null) {
  const items = []
  const totals = personTotals()
  const people = Object.values(state.people)

  for (const p of people) {
    const t = totals.get(p.id)
    const where = t.parts.map(x => `${x.group.name} ${x.pct}%`).join(', ')
    if (t.total > 100) {
      items.push({ kind: 'over', severity: 'high', title: `${p.name} is at ${t.total}%`, detail: `Over-allocated: ${where}. Trim a share or drop a membership.`, ref: { type: 'person', id: p.id } })
    } else if (t.count > 0 && t.total < 100) {
      items.push({ kind: 'under', severity: 'low', title: `${p.name} is at ${t.total}%`, detail: `${100 - t.total}% unallocated: ${where}. Fine if part-time; otherwise someone is missing a share.`, ref: { type: 'person', id: p.id } })
    }
  }
  const unassigned = people.filter(p => totals.get(p.id).count === 0)
  if (unassigned.length) {
    items.push({ kind: 'unassigned', severity: 'low', title: `${plural(unassigned.length, 'person', 'people')} on no team`, detail: unassigned.map(p => p.name).join(', '), ref: unassigned.length === 1 ? { type: 'person', id: unassigned[0].id } : null })
  }

  for (const g of allGroups()) {
    const s = groupStats(g.id)
    if (!s.own && !childrenOf(g.id).length) {
      items.push({ kind: 'empty', severity: 'medium', title: `${g.name} is empty`, detail: g.kind === 'band' ? 'A shared space with nobody in it. Drag someone in, or delete it.' : 'No members and no sub-groups. Drag someone in, or delete it.', ref: { type: 'group', id: g.id } })
    }
    if (s.over > 0) {
      items.push({ kind: 'capacity', severity: 'medium', title: `${g.name} is over capacity`, detail: `${s.deep} seated for a capacity of ${s.capacity}.`, ref: { type: 'group', id: g.id } })
    }
  }

  // core-hours overlap: a team spread so wide its working days barely meet
  for (const g of allGroups()) {
    if (g.kind === 'band') continue
    const ids = new Set(g.members.map(m => m.person))
    for (const d of descendantsOf(g.id)) for (const m of d.members) ids.add(m.person)
    const ppl = [...ids].map(id => state.people[id]).filter(Boolean)
    const ov = coreOverlap(ppl)
    if (ov.hours === null) continue
    if (ov.hours < 3) {
      const zones = [...new Set(ov.known.map(k => k.label.split('/').pop().replace(/_/g, ' ')))]
      items.push({ kind: 'timezones', severity: ov.hours < 1 ? 'high' : 'medium', title: `${g.name} shares ${ov.hours === 0 ? 'no' : ov.hours} core hour${ov.hours === 1 ? '' : 's'}`, detail: `${ov.known.length} people across ${zones.length} zones (${zones.slice(0, 4).join(', ')}${zones.length > 4 ? '…' : ''}). Working days of 09:00 to 17:00 local barely meet; plan async or shift one end.`, ref: { type: 'group', id: g.id } })
    }
  }

  // skills coverage: a group that needs a tag nobody in it (or its sub-groups) carries
  for (const g of allGroups()) {
    if (!g.needs?.length) continue
    const have = new Set()
    for (const m of g.members) for (const t of state.people[m.person]?.tags || []) have.add(t)
    for (const d of descendantsOf(g.id)) for (const m of d.members) for (const t of state.people[m.person]?.tags || []) have.add(t)
    const missing = g.needs.filter(t => !have.has(t))
    if (missing.length) {
      const holders = Object.values(state.people).filter(p => p.tags?.some(t => missing.includes(t))).map(p => p.name)
      items.push({ kind: 'skills', severity: 'medium', title: `${g.name} is missing ${missing.map(t => `"${t}"`).join(', ')}`, detail: holders.length ? `Nobody seated here has it. People who do: ${holders.slice(0, 5).join(', ')}.` : 'Nobody in the roster carries that tag yet.', ref: { type: 'group', id: g.id } })
    }
  }

  if (layout?.overlaps?.length) {
    for (const [a, b] of layout.overlaps) {
      items.push({ kind: 'overlap', severity: 'medium', title: `Rooms overlap: ${state.groups[a]?.name} and ${state.groups[b]?.name}`, detail: 'Two rooms share cells. Drag one aside, or clear its layout to let the packer place it.', ref: { type: 'group', id: a } })
    }
  }

  const noLoc = people.filter(p => !p.location)
  if (noLoc.length && people.length > 2) {
    items.push({ kind: 'location', severity: 'low', title: `${plural(noLoc.length, 'person', 'people')} without a location`, detail: noLoc.map(p => p.name).join(', '), ref: noLoc.length === 1 ? { type: 'person', id: noLoc[0].id } : null })
  }

  const rank = { high: 0, medium: 1, low: 2 }
  items.sort((a, b) => rank[a.severity] - rank[b.severity])
  return items
}
