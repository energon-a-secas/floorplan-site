// ════════════════════════════════════════════════════════════
//  avatar.js: 12x12 procedural pixel people. Seeded from the name (so the
//  same person always looks the same), shirt coloured by the group they sit
//  in. Drawn once per (name, shirt) onto an offscreen canvas and cached as a
//  data URL; CSS scales it with image-rendering: pixelated. The same URL is
//  embedded in SVG/PNG exports, so the export cannot drift from the screen.
// ════════════════════════════════════════════════════════════

import { hashStr, mulberry32, hexToRgb, escHtml } from './utils.js'

export const AV = 12
const SKIN = ['#f9d3b4', '#eab68a', '#d9a06b', '#c68642', '#8d5524', '#5c3a21']
const HAIR = ['#2b1b0e', '#4a2c17', '#8a5a2b', '#d9a441', '#1c1c1c', '#c9c9c9', '#b5423a', '#3b2f6b', '#e8d4a2']
const PANTS = ['#1f2937', '#312e81', '#3f3f46', '#4b2e1f']
const cache = new Map()

/** Deterministic look for a name. */
export function avatarSpec(name) {
  const rnd = mulberry32(hashStr(String(name || '?').toLowerCase()))
  const pick = arr => arr[Math.floor(rnd() * arr.length)]
  return {
    skin: pick(SKIN), hair: pick(HAIR), pants: pick(PANTS),
    style: Math.floor(rnd() * 5),       // 0 flat, 1 tall, 2 side-swept, 3 long, 4 cap
    glasses: rnd() < 0.22,
    beard: rnd() < 0.18,
    eye: rnd() < 0.5 ? '#1c1c1c' : '#2f3b52',
  }
}

function shade(hex, f) {
  const c = hexToRgb(hex) || { r: 120, g: 120, b: 120 }
  const k = v => Math.max(0, Math.min(255, Math.round(v * f)))
  return `rgb(${k(c.r)},${k(c.g)},${k(c.b)})`
}

/** Draw the sprite at 1px per pixel-cell onto ctx at (ox, oy). */
export function drawAvatar(ctx, spec, shirt, ox = 0, oy = 0) {
  const px = (x, y, c) => { ctx.fillStyle = c; ctx.fillRect(ox + x, oy + y, 1, 1) }
  const row = (y, x0, x1, c) => { for (let x = x0; x <= x1; x++) px(x, y, c) }
  const S = shirt || '#64748b'
  // head
  row(2, 4, 7, spec.skin); row(3, 3, 8, spec.skin); row(4, 3, 8, spec.skin); row(5, 3, 8, spec.skin); row(6, 4, 7, spec.skin)
  // hair
  if (spec.style === 0) { row(1, 4, 7, spec.hair); row(2, 3, 8, spec.hair); px(3, 3, spec.hair); px(8, 3, spec.hair) }
  if (spec.style === 1) { row(0, 4, 7, spec.hair); row(1, 3, 8, spec.hair); row(2, 3, 8, spec.hair); px(3, 3, spec.hair); px(8, 3, spec.hair) }
  if (spec.style === 2) { row(1, 3, 7, spec.hair); row(2, 3, 8, spec.hair); px(3, 3, spec.hair); px(3, 4, spec.hair); px(8, 3, spec.hair) }
  if (spec.style === 3) { row(1, 4, 7, spec.hair); row(2, 3, 8, spec.hair); for (let y = 3; y <= 6; y++) { px(2, y, spec.hair); px(9, y, spec.hair) } px(3, 3, spec.hair); px(8, 3, spec.hair) }
  if (spec.style === 4) { row(1, 3, 8, S); row(2, 3, 9, S); px(9, 2, shade(S, 0.7)); px(10, 2, shade(S, 0.7)) }
  // eyes, glasses, beard
  px(4, 4, spec.eye); px(7, 4, spec.eye)
  if (spec.glasses) { px(3, 4, '#e5e7eb'); px(5, 4, '#e5e7eb'); px(6, 4, '#e5e7eb'); px(8, 4, '#e5e7eb') }
  if (spec.beard) { row(6, 4, 7, spec.hair); px(3, 5, spec.hair); px(8, 5, spec.hair) }
  // body
  row(7, 3, 8, S); row(8, 2, 9, S); row(9, 2, 9, S); row(10, 3, 8, shade(S, 0.85))
  px(2, 10, spec.skin); px(9, 10, spec.skin)   // hands
  px(5, 8, shade(S, 1.15)); px(6, 8, shade(S, 1.15))  // chest highlight
  // legs
  px(4, 11, spec.pants); px(5, 11, spec.pants); px(6, 11, spec.pants); px(7, 11, spec.pants)
}

/** Cached data URL for (name, shirt). */
export function avatarDataUrl(name, shirt) {
  const key = `${name}|${shirt || ''}`
  if (cache.has(key)) return cache.get(key)
  if (typeof document === 'undefined') return ''
  const c = document.createElement('canvas')
  c.width = AV; c.height = AV
  const ctx = c.getContext('2d')
  drawAvatar(ctx, avatarSpec(name), shirt, 0, 0)
  const url = c.toDataURL('image/png')
  cache.set(key, url)
  return url
}

/** Markup for one sprite; `px` is the rendered size in CSS pixels. */
export function avatarImg(name, shirt, { px = 36, cls = '' } = {}) {
  return `<img class="px-avatar ${cls}" src="${avatarDataUrl(name, shirt)}" alt="" width="${px}" height="${px}" draggable="false" data-svg="img">`
}

/** A 1-bit "vacant desk" marker in the same style (used for open headcount). */
export function vacantImg(px = 36) {
  const key = 'vacant'
  if (!cache.has(key)) {
    const c = document.createElement('canvas'); c.width = AV; c.height = AV
    const ctx = c.getContext('2d')
    ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.setLineDash([1, 1]); ctx.lineWidth = 1
    ctx.strokeRect(3.5, 2.5, 5, 4); ctx.strokeRect(2.5, 7.5, 7, 3)
    cache.set(key, c.toDataURL('image/png'))
  }
  return `<img class="px-avatar px-avatar--vacant" src="${cache.get(key)}" alt="" width="${px}" height="${px}" draggable="false">`
}

// ── Pixel font: loaded once, only when the building view first renders ──
let fontRequested = false
export function loadPixelFont() {
  if (fontRequested || typeof document === 'undefined') return
  fontRequested = true
  const link = document.createElement('link')
  link.id = 'font-silkscreen'
  link.rel = 'stylesheet'
  link.href = 'https://fonts.googleapis.com/css2?family=Silkscreen:wght@400;700&display=swap'
  document.head.appendChild(link)
}

export function avatarTitle(name) { return escHtml(name) }
