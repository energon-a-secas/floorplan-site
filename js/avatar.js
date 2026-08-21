// ════════════════════════════════════════════════════════════
//  avatar.js: 12x12 procedural pixel sprites. Seeded from the name (so
//  the same person always looks the same), shirt coloured by the group they
//  sit in, and customisable per person: kind (person, cat, dog, robot),
//  hair, skin, glasses, beard, an item (laptop, coffee, headset, hat) and a
//  shirt colour. A dozen presets cover the common looks. Drawn once per
//  (name, shirt, spec) onto an offscreen canvas and cached as a data URL;
//  CSS scales it with image-rendering: pixelated, and the same URL lands in
//  SVG/PNG exports so they cannot drift from the screen.
// ════════════════════════════════════════════════════════════

import { hashStr, mulberry32, hexToRgb, isHex, escHtml } from './utils.js'

export const AV = 12
export const SKIN = ['#f9d3b4', '#eab68a', '#d9a06b', '#c68642', '#8d5524', '#5c3a21']
export const HAIR = ['#2b1b0e', '#4a2c17', '#8a5a2b', '#d9a441', '#1c1c1c', '#c9c9c9', '#b5423a', '#3b2f6b', '#e8d4a2']
export const COAT = ['#f2a65a', '#c9c9c9', '#3a3a3a', '#a8703a', '#f4efe6', '#7a5230']
const PANTS = ['#1f2937', '#312e81', '#3f3f46', '#4b2e1f']
export const KINDS = ['person', 'cat', 'dog', 'robot']
export const HAIR_STYLES = ['flat', 'tall', 'side', 'long', 'cap']
export const ITEMS = ['none', 'laptop', 'coffee', 'headset', 'hat']
const cache = new Map()

/** Named looks a visitor can pick instead of editing fields. */
export const PRESETS = [
  { id: 'seeded', name: 'Seeded (default)', spec: null },
  { id: 'classic', name: 'Classic', spec: { kind: 'person', hair: 0, glasses: false, beard: false, item: 'none' } },
  { id: 'glasses', name: 'Glasses', spec: { kind: 'person', hair: 2, glasses: true, item: 'none' } },
  { id: 'cap', name: 'Cap', spec: { kind: 'person', hair: 4, item: 'none' } },
  { id: 'beard', name: 'Beard', spec: { kind: 'person', hair: 1, beard: true, item: 'none' } },
  { id: 'long', name: 'Long hair', spec: { kind: 'person', hair: 3, item: 'none' } },
  { id: 'headset', name: 'Headset', spec: { kind: 'person', item: 'headset' } },
  { id: 'laptop', name: 'Laptop', spec: { kind: 'person', item: 'laptop' } },
  { id: 'coffee', name: 'Coffee', spec: { kind: 'person', item: 'coffee' } },
  { id: 'tophat', name: 'Top hat', spec: { kind: 'person', item: 'hat' } },
  { id: 'cat', name: 'Cat', spec: { kind: 'cat' } },
  { id: 'dog', name: 'Dog', spec: { kind: 'dog' } },
  { id: 'robot', name: 'Robot', spec: { kind: 'robot' } },
]
export const presetById = id => PRESETS.find(p => p.id === id) || null

/** Seeded look for a name, then the person's own choices on top. */
export function avatarSpec(name, custom) {
  const rnd = mulberry32(hashStr(String(name || '?').toLowerCase()))
  const pick = arr => arr[Math.floor(rnd() * arr.length)]
  const base = {
    kind: 'person',
    skin: pick(SKIN), hair: pick(HAIR), pants: pick(PANTS), coat: pick(COAT),
    style: Math.floor(rnd() * 5),       // 0 flat, 1 tall, 2 side-swept, 3 long, 4 cap
    glasses: rnd() < 0.22,
    beard: rnd() < 0.18,
    eye: rnd() < 0.5 ? '#1c1c1c' : '#2f3b52',
    item: 'none',
  }
  return applyCustom(base, custom)
}

function applyCustom(base, c) {
  if (!c) return base
  if (typeof c === 'string') {
    const preset = presetById(c)
    if (preset) return applyCustom(base, preset.spec)
    if (KINDS.includes(c)) return { ...base, kind: c }
    return base
  }
  if (typeof c !== 'object') return base
  const out = { ...base }
  if (c.preset) Object.assign(out, applyCustom(base, String(c.preset)))
  if (KINDS.includes(c.kind)) out.kind = c.kind
  if (c.hair !== undefined) { const i = typeof c.hair === 'string' ? HAIR_STYLES.indexOf(c.hair) : Number(c.hair); if (i >= 0 && i < 5) out.style = i }
  if (c.hairColor !== undefined) out.hair = isHex(c.hairColor) ? c.hairColor : (HAIR[Number(c.hairColor)] || out.hair)
  if (c.skin !== undefined) out.skin = isHex(c.skin) ? c.skin : (SKIN[Number(c.skin)] || out.skin)
  if (c.coat !== undefined) out.coat = isHex(c.coat) ? c.coat : (COAT[Number(c.coat)] || out.coat)
  if (c.glasses !== undefined) out.glasses = !!c.glasses
  if (c.beard !== undefined) out.beard = !!c.beard
  if (ITEMS.includes(c.item)) out.item = c.item
  if (isHex(c.shirt)) out.shirt = c.shirt
  return out
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
  const S = spec.shirt || shirt || '#64748b'
  if (spec.kind === 'cat') return drawCat(px, row, spec, S)
  if (spec.kind === 'dog') return drawDog(px, row, spec, S)
  if (spec.kind === 'robot') return drawRobot(px, row, spec, S)
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
  drawItem(px, row, spec, S)
}

function drawItem(px, row, spec, S) {
  if (spec.item === 'headset') { row(1, 3, 8, '#374151'); px(2, 2, '#374151'); px(9, 2, '#374151'); px(2, 3, '#374151'); px(9, 3, '#374151'); px(9, 4, '#374151'); px(9, 5, '#9ca3af'); px(8, 6, '#9ca3af') }
  if (spec.item === 'hat') { row(0, 3, 8, '#111827'); row(1, 4, 7, '#111827'); row(2, 2, 9, '#111827'); px(4, 1, '#b45309'); px(7, 1, '#b45309') }
  if (spec.item === 'laptop') { row(9, 1, 5, '#9ca3af'); row(10, 1, 5, '#cbd5e1'); px(2, 9, '#60a5fa'); px(3, 9, '#60a5fa'); px(4, 9, '#60a5fa') }
  if (spec.item === 'coffee') { row(8, 9, 10, '#f8fafc'); row(9, 9, 10, '#f8fafc'); px(11, 8, '#f8fafc'); px(9, 7, '#e5e7eb'); px(10, 10, shade(S, 0.8)) }
}

function drawCat(px, row, spec, S) {
  const C = spec.coat, D = shade(C, 0.7)
  px(3, 1, C); px(8, 1, C); px(3, 2, C); px(4, 2, C); px(7, 2, C); px(8, 2, C)     // ears
  px(3, 2, '#f9a8d4'); px(8, 2, '#f9a8d4')
  row(3, 3, 8, C); row(4, 3, 8, C); row(5, 3, 8, C); row(6, 4, 7, C)
  px(4, 4, '#1c1c1c'); px(7, 4, '#1c1c1c'); px(5, 5, '#f9a8d4'); px(6, 5, '#f9a8d4')   // eyes, nose
  px(2, 5, D); px(9, 5, D)   // whiskers
  if (spec.glasses) { px(3, 4, '#e5e7eb'); px(5, 4, '#e5e7eb'); px(6, 4, '#e5e7eb'); px(8, 4, '#e5e7eb') }
  row(7, 3, 8, S); row(8, 2, 9, S); row(9, 2, 9, S); row(10, 3, 8, shade(S, 0.85))   // shirt/collar body
  px(2, 10, C); px(9, 10, C); px(10, 9, C); px(11, 8, C)    // paws + tail
  px(4, 11, D); px(5, 11, D); px(6, 11, D); px(7, 11, D)
  drawItem(px, row, spec, S)
}

function drawDog(px, row, spec, S) {
  const C = spec.coat, D = shade(C, 0.7)
  px(2, 2, D); px(2, 3, D); px(2, 4, D); px(9, 2, D); px(9, 3, D); px(9, 4, D)   // floppy ears
  row(2, 4, 7, C); row(3, 3, 8, C); row(4, 3, 8, C); row(5, 3, 8, C); row(6, 4, 7, C)
  px(4, 4, '#1c1c1c'); px(7, 4, '#1c1c1c'); row(5, 5, 6, shade(C, 1.25)); px(5, 6, '#1c1c1c'); px(6, 6, '#1c1c1c')   // eyes, snout, nose
  if (spec.glasses) { px(3, 4, '#e5e7eb'); px(5, 4, '#e5e7eb'); px(6, 4, '#e5e7eb'); px(8, 4, '#e5e7eb') }
  row(7, 3, 8, S); row(8, 2, 9, S); row(9, 2, 9, S); row(10, 3, 8, shade(S, 0.85))
  px(2, 10, C); px(9, 10, C); px(10, 9, C); px(11, 8, C)
  px(4, 11, D); px(5, 11, D); px(6, 11, D); px(7, 11, D)
  drawItem(px, row, spec, S)
}

function drawRobot(px, row, spec, S) {
  const M = '#9ca3af', D = '#4b5563'
  px(5, 0, '#f43f5e'); px(5, 1, D); px(6, 1, D)   // antenna
  row(2, 3, 8, M); row(3, 3, 8, M); row(4, 3, 8, M); row(5, 3, 8, M); row(6, 3, 8, M)
  px(4, 4, '#22d3ee'); px(7, 4, '#22d3ee'); row(6, 4, 7, D)   // eyes, mouth grille
  px(2, 4, D); px(9, 4, D)   // side bolts
  row(7, 3, 8, S); row(8, 2, 9, S); row(9, 2, 9, S); row(10, 3, 8, shade(S, 0.85))
  px(5, 8, '#22d3ee'); px(6, 8, shade(S, 1.15))
  px(2, 10, M); px(9, 10, M)
  px(4, 11, D); px(5, 11, D); px(6, 11, D); px(7, 11, D)
  drawItem(px, row, spec, S)
}

/** Cached data URL for (name, shirt, custom spec). */
export function avatarDataUrl(name, shirt, custom = null) {
  const key = `${name}|${shirt || ''}|${custom ? JSON.stringify(custom) : ''}`
  if (cache.has(key)) return cache.get(key)
  if (typeof document === 'undefined') return ''
  const c = document.createElement('canvas')
  c.width = AV; c.height = AV
  drawAvatar(c.getContext('2d'), avatarSpec(name, custom), shirt, 0, 0)
  const url = c.toDataURL('image/png')
  cache.set(key, url)
  return url
}

/** Markup for one sprite; `px` is the rendered size in CSS pixels. */
export function avatarImg(name, shirt, { px = 36, cls = '', custom = null } = {}) {
  return `<img class="px-avatar ${cls}" src="${avatarDataUrl(name, shirt, custom)}" alt="" width="${px}" height="${px}" draggable="false" data-svg="img">`
}

/** Placeholder for an open seat: a dashed desk outline, or a pet waiting for its human. */
export function vacantImg(px = 36, placeholder = 'desk') {
  if (placeholder === 'cat' || placeholder === 'dog') {
    return `<img class="px-avatar px-avatar--vacant px-avatar--pet" src="${avatarDataUrl('open seat ' + placeholder, '#475569', { kind: placeholder, coat: placeholder === 'cat' ? '#c9c9c9' : '#a8703a' })}" alt="" width="${px}" height="${px}" draggable="false">`
  }
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
