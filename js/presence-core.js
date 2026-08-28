// ════════════════════════════════════════════════════════════
//  presence-core.js: the pure half of Visit-mode presence. No DOM, no
//  network, no imports, so Node can test the heartbeat throttling, the
//  stale filtering and the map key without a browser. presence.js owns
//  the Convex client, the elements on #buildingLayer and the pill; this
//  file only decides *when* to send and *what* of the wire data to trust.
// ════════════════════════════════════════════════════════════

/** Heartbeat cadence: at most one every MOVE_MS while moving, one every IDLE_MS as keep-alive. */
export const MOVE_MS = 600
export const IDLE_MS = 5000
/** How often the others query runs. */
export const POLL_MS = 2000
/** A row whose updatedAt is older than this is ignored (matches FRESH_MS in convex/presence.ts). */
export const TTL_MS = 15000

/** The gate: presence only runs against an https convex.cloud deployment URL. */
export function isConfiguredUrl(url) {
  return /^https:\/\/[a-z0-9-]+\.convex\.cloud$/.test(String(url || ''))
}

/** FNV-1a over the canonical YAML text: two tabs on the same #d= link share a room. */
export function mapKeyFor(text) {
  let h = 2166136261
  for (const ch of String(text ?? '')) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) }
  return 'm' + (h >>> 0).toString(36)
}

/** Ephemeral guest tag: no accounts, so the name is just the session's first hex. */
export function guestName(sessionId) {
  return 'guest-' + String(sessionId || '').replace(/[^a-z0-9]/gi, '').slice(0, 4).toLowerCase()
}

/** Keep rows that are someone else, well formed and fresh at time `now`. */
export function freshRows(rows, now, ttlMs = TTL_MS, selfId = '') {
  return (Array.isArray(rows) ? rows : []).filter(r =>
    r && typeof r === 'object' &&
    typeof r.sessionId === 'string' && r.sessionId !== selfId &&
    Number.isFinite(r.x) && Number.isFinite(r.y) &&
    Number.isFinite(r.updatedAt) && now - r.updatedAt <= ttlMs
  )
}

/**
 * The presence loop. `client` is anything with async query(name, args) and
 * mutation(name, args) (the ConvexHttpClient, or a fake in tests). Drive it
 * with tick(t) on a short interval; every timestamp comes in from outside,
 * so tests own the clock. Network errors are swallowed: presence is a
 * decoration and must never surface as an app error.
 */
export function createPresenceCore(opts) {
  const { client, mapKey, sessionId, name, onOthers = () => {} } = opts
  const spec = opts.spec ?? null
  const moveMs = opts.moveMs ?? MOVE_MS
  const idleMs = opts.idleMs ?? IDLE_MS
  const pollMs = opts.pollMs ?? POLL_MS
  const ttlMs = opts.ttlMs ?? TTL_MS

  let pos = { x: opts.x ?? 0, y: opts.y ?? 0 }
  let dirty = true               // first tick introduces us immediately
  let lastBeat = -Infinity
  let lastPoll = -Infinity
  let stopped = false

  function move(x, y) {
    if (stopped || (x === pos.x && y === pos.y)) return
    pos = { x, y }
    dirty = true
  }

  async function tick(t) {
    if (stopped) return
    const due = lastBeat + (dirty ? moveMs : idleMs)
    if (t >= due) {
      lastBeat = t; dirty = false
      try {
        await client.mutation('presence:heartbeat', { mapKey, sessionId, name, spec, x: pos.x, y: pos.y })
      } catch { /* offline or undeployed: stay quiet, the next beat retries */ }
    }
    if (stopped || t < lastPoll + pollMs) return
    lastPoll = t
    try {
      const rows = await client.query('presence:others', { mapKey, sessionId })
      if (!stopped) onOthers(freshRows(rows, t, ttlMs, sessionId))
    } catch { /* quiet: no rows this round */ }
  }

  async function stop() {
    if (stopped) return
    stopped = true
    try { await client.mutation('presence:leave', { mapKey, sessionId }) } catch { /* TTL cleans up */ }
  }

  return { move, tick, stop, get pos() { return pos }, get stopped() { return stopped } }
}
