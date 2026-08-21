// ════════════════════════════════════════════════════════════
//  layout.js: where every room goes in the building view. Pure: reads the
//  model, returns rects in grid cells. Renderers and the SVG exporter scale
//  cells to pixels; nothing here knows about the DOM.
//
//  Roles: a top-level group with children and no members of its own is a
//  TITLE band over its children, which become rooms. Any other top-level
//  group is a room. Deeper groups are SUB-rooms: partitions of the parent.
//  Bands (shared spaces) are rooms whose rect derives from what they span.
// ════════════════════════════════════════════════════════════

import { state, allGroups, topGroups, bands as bandList, childrenOf, membershipsOf } from './state.js'

export const COLS = 24
const EPS = 1e-6
const near = (a, b) => Math.abs(a - b) < EPS
const intersects = (a, b) => a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS

export function isTitleGroup(g) {
  return g && g.kind === 'group' && g.parent === null && g.members.length === 0 && childrenOf(g.id).length > 0
}

// A compact seat is 1.55 x 1.6 cells (see building.css); rooms are sized so
// whole seats fit: width from the seat count, height from the rows it takes.
export const SEAT_W = 1.6, SEAT_H = 1.7
function roomSize(g) {
  const own = g.members.length, kids = childrenOf(g.id).length
  const plaque = g.owns.length ? 1 : 0
  if (kids) return { w: Math.min(COLS, Math.max(6, kids * 4)), h: 7 + (own ? 2 : 0) + plaque }
  const w = Math.min(10, Math.max(4, Math.ceil(Math.sqrt(Math.max(1, own)) * SEAT_W) + 1))
  const perRow = Math.max(1, Math.floor((w - 0.4) / SEAT_W))
  const rows = Math.max(1, Math.ceil(own / perRow))
  return { w, h: Math.max(4, Math.ceil(1 + rows * SEAT_H + 0.3 + plaque)) }
}

/** The wall two rects share, if they touch along at least one cell. */
export function sharedEdge(a, b) {
  if (!a || !b) return null
  if (near(a.x + a.w, b.x) || near(b.x + b.w, a.x)) {
    const x = near(a.x + a.w, b.x) ? b.x : a.x
    const y0 = Math.max(a.y, b.y), y1 = Math.min(a.y + a.h, b.y + b.h)
    if (y1 - y0 >= 1 - EPS) return { orient: 'v', x, y0, y1, mid: (y0 + y1) / 2 }
  }
  if (near(a.y + a.h, b.y) || near(b.y + b.h, a.y)) {
    const y = near(a.y + a.h, b.y) ? b.y : a.y
    const x0 = Math.max(a.x, b.x), x1 = Math.min(a.x + a.w, b.x + b.w)
    if (x1 - x0 >= 1 - EPS) return { orient: 'h', y, x0, x1, mid: (x0 + x1) / 2 }
  }
  return null
}

function corridorPath(a, b) {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  if (a.x + a.w <= b.x + EPS || b.x + b.w <= a.x + EPS) {
    const left = a.x < b.x ? a : b, right = left === a ? b : a
    const x0 = left.x + left.w, x1 = right.x, mx = (x0 + x1) / 2
    const ly = left.y + left.h / 2, ry = right.y + right.h / 2
    return [[x0, ly], [mx, ly], [mx, ry], [x1, ry]]
  }
  if (a.y + a.h <= b.y + EPS || b.y + b.h <= a.y + EPS) {
    const top = a.y < b.y ? a : b, bot = top === a ? b : a
    const y0 = top.y + top.h, y1 = bot.y, my = (y0 + y1) / 2
    const tx = top.x + top.w / 2, bx = bot.x + bot.w / 2
    return [[tx, y0], [tx, my], [bx, my], [bx, y1]]
  }
  return [[ac.x, ac.y], [bc.x, bc.y]]
}

export function computeLayout() {
  const rects = {}
  const placed = []          // top-level rects the packer must avoid
  const autoRooms = []       // ids packed automatically (shift when bands land on them)
  const groups = allGroups()
  const tops = topGroups()
  const titles = tops.filter(isTitleGroup)
  const titleIds = new Set(titles.map(t => t.id))
  const roomOf = g => titleIds.has(g.parent) || (g.parent === null && g.kind === 'group' && !titleIds.has(g.id))

  // explicit layouts first, so the packer flows around them
  for (const g of groups) {
    if ((roomOf(g) || g.kind === 'band') && g.layout) {
      rects[g.id] = { ...g.layout, kind: g.kind === 'band' ? 'band' : 'room', depth: 0, auto: false }
      placed.push(rects[g.id])
    }
  }

  // greedy packer: rooms touch (shared walls make doors possible)
  const cur = { x: 0, y: 0, rowH: 0 }
  const newRow = () => { if (cur.rowH || cur.x) { cur.y += cur.rowH; cur.x = 0; cur.rowH = 0 } }
  const place = (w, h) => {
    let guard = 0
    while (guard++ < 4000) {
      if (cur.x + w > COLS + EPS) { cur.y += cur.rowH || 1; cur.x = 0; cur.rowH = 0; continue }
      const r = { x: cur.x, y: cur.y, w, h }
      if (placed.some(p => intersects(p, r))) { cur.x += 1; continue }
      cur.x += w; cur.rowH = Math.max(cur.rowH, h)
      return r
    }
    return { x: 0, y: cur.y + cur.rowH, w, h }
  }
  const packRoom = g => {
    if (rects[g.id]) return
    const { w, h } = roomSize(g)
    const r = place(w, h)
    rects[g.id] = { ...r, kind: 'room', depth: 0, auto: true }
    placed.push(rects[g.id]); autoRooms.push(g.id)
  }
  for (const g of tops) {
    if (g.kind !== 'group') continue
    if (titleIds.has(g.id)) {
      newRow()
      const titleY = cur.y
      cur.y += 1
      childrenOf(g.id).forEach(packRoom)
      newRow()
      rects[g.id] = { x: 0, y: titleY, w: 1, h: 1, kind: 'title', depth: 0, auto: true }  // bbox fixed below
    } else {
      packRoom(g)
    }
  }

  // sub-rooms: partitions of the parent's body
  const partition = (g, rect, depth) => {
    const kids = childrenOf(g.id); if (!kids.length) return
    const ownRows = g.members.length ? SEAT_H + 0.2 : 0
    const plaque = g.owns.length && depth === 0 ? 1 : 0
    const body = { x: rect.x, y: rect.y + 1 + ownRows, w: rect.w, h: Math.max(1, rect.h - 1 - ownRows - plaque) }
    const n = kids.length
    const horizontal = body.w / n >= 2.5 || body.h < 3
    kids.forEach((k, i) => {
      const r = horizontal
        ? { x: body.x + (body.w / n) * i, y: body.y, w: body.w / n, h: body.h }
        : { x: body.x, y: body.y + (body.h / n) * i, w: body.w, h: body.h / n }
      rects[k.id] = { ...r, kind: 'sub', depth: depth + 1, auto: true }
      partition(k, r, depth + 1)
    })
  }
  const partitionAll = () => { for (const g of groups) if (rects[g.id]?.kind === 'room') partition(g, rects[g.id], 0) }
  partitionAll()

  // bands derive from what they span; rooms they would cover shift down
  const bandRects = () => {
    const done = []
    for (const b of bandList()) {
      if (b.layout) { done.push(rects[b.id]); continue }
      const spanned = b.spans.map(id => rects[id]).filter(Boolean)
      let x = 0, right = COLS, y = 0
      if (spanned.length) {
        x = Math.min(...spanned.map(r => r.x)); right = Math.max(...spanned.map(r => r.x + r.w)); y = Math.max(...spanned.map(r => r.y + r.h))
      } else {
        y = Math.max(0, ...Object.values(rects).filter(r => r.kind !== 'sub').map(r => r.y + r.h))
      }
      for (const d of done) if (d.x < right - EPS && x < d.x + d.w - EPS) y = Math.max(y, d.y + d.h)
      rects[b.id] = { x, y, w: right - x, h: b.members.length ? 1 + SEAT_H + 0.3 : 1, kind: 'band', depth: 0, auto: true }
      done.push(rects[b.id])
    }
    return done
  }
  for (let pass = 0; pass < 3; pass++) {
    const bandsNow = bandRects()
    let moved = false
    for (const id of autoRooms) {
      const r = rects[id]
      for (const b of bandsNow) {
        if (b !== r && intersects(r, b) && r.y >= b.y - EPS) { r.y = b.y + b.h; moved = true }
      }
    }
    if (!moved) break
    partitionAll()
  }

  // title bbox over its children
  for (const t of titles) {
    const kids = childrenOf(t.id).map(k => rects[k.id]).filter(Boolean)
    if (!kids.length) continue
    const x = Math.min(...kids.map(r => r.x)), right = Math.max(...kids.map(r => r.x + r.w)), y = Math.min(...kids.map(r => r.y))
    rects[t.id] = { x, y: Math.max(0, y - 1), w: right - x, h: 1, kind: 'title', depth: 0, auto: true }
  }

  // straddles: a person in exactly two groups whose rects share a wall
  const straddles = []
  for (const p of Object.values(state.people)) {
    const ms = membershipsOf(p.id)
    if (ms.length !== 2) continue
    const a = rects[ms[0].group.id], b = rects[ms[1].group.id]
    const edge = sharedEdge(a, b)
    if (!edge) continue
    straddles.push(edge.orient === 'v'
      ? { person: p.id, a: ms[0].group.id, b: ms[1].group.id, x: edge.x, y: Math.min(edge.y1 - 0.7, edge.y0 + 1.7 + 1.3 * straddles.filter(s => s.a === ms[0].group.id && s.b === ms[1].group.id).length) }
      : { person: p.id, a: ms[0].group.id, b: ms[1].group.id, x: Math.min(edge.x1 - 0.7, edge.x0 + 1 + 1.4 * straddles.filter(s => s.a === ms[0].group.id && s.b === ms[1].group.id).length), y: edge.y })
  }

  // doors and corridors
  const doors = [], corridors = []
  for (const l of state.links) {
    const a = rects[l.from], b = rects[l.to]
    if (!a || !b) continue
    const edge = l.kind === 'corridor' ? null : sharedEdge(a, b)
    if (edge) {
      // a straddle seat sits on the upper/left part of a shared wall; put the door at the far end then
      const busy = straddles.some(s => (s.a === l.from && s.b === l.to) || (s.a === l.to && s.b === l.from))
      const at = busy ? (edge.orient === 'v' ? edge.y1 - 0.5 : edge.x1 - 0.5) : edge.mid
      doors.push(edge.orient === 'v'
        ? { id: l.id, a: l.from, b: l.to, orient: 'v', x: edge.x, y: at, cell: Math.floor(at), label: l.label }
        : { id: l.id, a: l.from, b: l.to, orient: 'h', x: at, y: edge.y, cell: Math.floor(at), label: l.label })
    } else {
      corridors.push({ id: l.id, a: l.from, b: l.to, points: corridorPath(a, b), label: l.label })
    }
  }
  // every room and band gets an entrance on its bottom wall
  const entrances = []
  for (const [id, r] of Object.entries(rects)) {
    if (r.kind !== 'room' && r.kind !== 'band') continue
    entrances.push({ group: id, orient: 'h', x: r.x + Math.floor(r.w / 2) + 0.5, y: r.y + r.h, cell: r.x + Math.floor(r.w / 2) })
  }

  // overlaps among top-level rects (titles excluded: they sit over their children by design)
  const overlaps = []
  const topRects = Object.entries(rects).filter(([, r]) => r.kind === 'room' || r.kind === 'band')
  for (let i = 0; i < topRects.length; i++) for (let j = i + 1; j < topRects.length; j++) {
    if (intersects(topRects[i][1], topRects[j][1])) overlaps.push([topRects[i][0], topRects[j][0]])
  }

  const all = Object.values(rects)
  const cols = Math.max(COLS, Math.ceil(Math.max(0, ...all.map(r => r.x + r.w))))
  const rows = Math.max(6, Math.ceil(Math.max(0, ...all.map(r => r.y + r.h))) + 1)
  return { rects, doors, corridors, entrances, straddles, overlaps, cols, rows }
}

/** Walkability for Visit mode: same room, or a door on the wall between the two cells. */
export function passableGrid(layout) {
  const owners = Object.entries(layout.rects).filter(([, r]) => r.kind === 'room' || r.kind === 'band')
  const ownerAt = (x, y) => {
    const hit = owners.find(([, r]) => x >= r.x - EPS && x < r.x + r.w - EPS && y >= r.y - EPS && y < r.y + r.h - EPS)
    return hit ? hit[0] : null
  }
  const gaps = [...layout.doors, ...layout.entrances]
  const doorBetween = (ax, ay, bx, by) => {
    if (ay === by) {  // horizontal move across a vertical wall at x = max(ax,bx)
      const wx = Math.max(ax, bx)
      return gaps.some(d => d.orient === 'v' && near(d.x, wx) && d.cell === ay)
    }
    const wy = Math.max(ay, by)
    return gaps.some(d => d.orient === 'h' && near(d.y, wy) && d.cell === ax)
  }
  return {
    cols: layout.cols, rows: layout.rows,
    ownerAt,
    canMove(ax, ay, bx, by) {
      if (bx < 0 || by < 0 || bx >= layout.cols || by >= layout.rows) return false
      const oa = ownerAt(ax, ay), ob = ownerAt(bx, by)
      if (oa === ob) return true
      return doorBetween(ax, ay, bx, by)
    },
  }
}
