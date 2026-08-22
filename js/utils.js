// ════════════════════════════════════════════════════════════
//  utils.js: thin site helpers. The shared DOM kit (js/neorgon-dom.js,
//  canonical: packages/neorgon-ui/dom/dom.js) owns escaping, toasts,
//  clipboard and downloads; this file only re-exports it and adds the
//  handful of pure helpers the floorplan model needs.
// ════════════════════════════════════════════════════════════

export {
  escHtml, debounce, throttle, clamp, uid, prefersReducedMotion,
  showToast, copyText, downloadBlob, downloadText,
} from './neorgon-dom.js'

/** Cached element lookup by id. The board re-creates #buildingLayer on every render, so a cached element is only trusted while it is still in the document. */
const _els = {}
export function $(id) {
  const el = _els[id]
  if (el && el.isConnected) return el
  return (_els[id] = document.getElementById(id))
}

/** "Team Kestrel" -> "team-kestrel". Stable, ASCII, max 48 chars. */
export function slug(text) {
  return String(text ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'item'
}

/** "Maya Kowalski" -> "MK"; "Maya" -> "MA"; "" -> "?" */
export function initials(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Base64url over UTF-8 bytes (same shape as slides-site and proctor-site). */
export function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  bytes.forEach(b => { bin += String.fromCharCode(b) })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export function b64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))
}

/** Twelve distinguishable group colours; cycled by index. */
export const PALETTE = [
  '#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c',
  '#2dd4bf', '#f87171', '#c084fc', '#a3e635', '#22d3ee', '#fb7185',
]
export function colorAt(i) { return PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length] }

export function hexToRgb(hex) {
  const m = String(hex || '').trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const n = parseInt(h, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}
export function rgba(hex, a) {
  const c = hexToRgb(hex) || { r: 148, g: 163, b: 184 }
  return `rgba(${c.r},${c.g},${c.b},${a})`
}
export function isHex(v) { return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(v || '')) }

/** Deterministic PRNG (mulberry32) + string hash, for seeded avatars. */
export function hashStr(str) {
  let h = 2166136261
  for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) }
  return h >>> 0
}
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Format a sum of pct/100 as FTE: 3.5, 2, 0.25 */
export function fmtFte(n) {
  const v = Math.round(n * 100) / 100
  return Number.isInteger(v) ? String(v) : String(v).replace(/0+$/, '')
}

export function plural(n, one, many = one + 's') { return n === 1 ? `${n} ${one}` : `${n} ${many}` }
