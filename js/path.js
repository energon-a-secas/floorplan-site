// ════════════════════════════════════════════════════════════
//  path.js: routes over the building grid for Sim mode. Pure functions
//  over the object passableGrid() returns (cols, rows, ownerAt, canMove):
//  a breadth-first search between integer cells, and the cell helpers the
//  brain needs to pick places to stand. Nothing here touches the DOM.
// ════════════════════════════════════════════════════════════

const keyOf = (x, y, cols) => y * cols + x

/** Shortest route from cell `from` to cell `to`, as a list of cells excluding `from` (empty if already there, null if unreachable). */
export function findPath(grid, from, to, { limit = 6000 } = {}) {
  const { cols, rows } = grid
  const sx = Math.floor(from.x), sy = Math.floor(from.y), tx = Math.floor(to.x), ty = Math.floor(to.y)
  if (sx === tx && sy === ty) return []
  if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) return null
  const prev = new Map([[keyOf(sx, sy, cols), null]])
  const queue = [[sx, sy]]
  let head = 0, seen = 0
  while (head < queue.length && seen++ < limit) {
    const [x, y] = queue[head++]
    if (x === tx && y === ty) break
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy
      const k = keyOf(nx, ny, cols)
      if (prev.has(k) || !grid.canMove(x, y, nx, ny)) continue
      prev.set(k, keyOf(x, y, cols))
      queue.push([nx, ny])
    }
  }
  const end = keyOf(tx, ty, cols)
  if (!prev.has(end)) return null
  const out = []
  for (let k = end; k !== null && k !== keyOf(sx, sy, cols); k = prev.get(k)) out.push({ x: k % cols, y: Math.floor(k / cols) })
  return out.reverse()
}

/** Integer cells inside a rect's interior: below the header row, inside the walls. */
export function interiorCells(rect, { skipTop = 1 } = {}) {
  const out = []
  const x0 = Math.ceil(rect.x), x1 = Math.floor(rect.x + rect.w) - 1
  const y0 = Math.ceil(rect.y) + skipTop, y1 = Math.floor(rect.y + rect.h) - 1
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y })
  return out
}

/** Cells nobody owns (the yard between rooms), in row order. */
export function yardCells(grid) {
  const out = []
  for (let y = 0; y < grid.rows; y++) for (let x = 0; x < grid.cols; x++) if (!grid.ownerAt(x, y)) out.push({ x, y })
  return out
}

/** The 4-neighbours of a cell that share its owner (a place to stand next to someone). */
export function besideCells(grid, cell) {
  const owner = grid.ownerAt(cell.x, cell.y)
  return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: cell.x + dx, y: cell.y + dy }))
    .filter(c => c.x >= 0 && c.y >= 0 && c.x < grid.cols && c.y < grid.rows && grid.ownerAt(c.x, c.y) === owner)
}

/** Pick `n` distinct cells from a list, closest-first to `near` with a little shuffle so crowds do not stack. */
export function spreadCells(cells, n, near, rng = Math.random) {
  const scored = cells.map(c => ({ c, d: (near ? Math.abs(c.x - near.x) + Math.abs(c.y - near.y) : 0) + rng() * 2 }))
  scored.sort((a, b) => a.d - b.d)
  return scored.slice(0, n).map(s => s.c)
}

export const cellOf = p => ({ x: Math.floor(p.x), y: Math.floor(p.y) })
export const sameCell = (a, b) => Math.floor(a.x) === Math.floor(b.x) && Math.floor(a.y) === Math.floor(b.y)
export const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
