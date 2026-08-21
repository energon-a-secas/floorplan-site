// ════════════════════════════════════════════════════════════
//  avatar.js: Floorplan's adapter over the shared Neorgon Avatar Kit
//  (js/neorgon-avatar.js, canonical in packages/neorgon-ui/avatar/).
//  The kit draws 16x16 characters from a spec; this file owns only what is
//  Floorplan-specific: the seeded look for a name with the group colour as
//  shirt, the legacy `avatar:` keys older documents used, the presets the
//  person sheet offers, the open-seat placeholders, and the lazy pixel font.
// ════════════════════════════════════════════════════════════

import * as K from './neorgon-avatar.js'
import { isHex, escHtml } from './utils.js'

export const AV = K.SIZE
export const SKIN = K.SKIN, HAIR = K.HAIR_COLORS, COAT = K.COAT
export const KINDS = K.CATALOG.kind.map(p => p.id)
export const HAIR_STYLES = ['flat', 'tall', 'side', 'long', 'cap']
export const ITEMS = ['none', 'laptop', 'coffee', 'headset', 'hat']

/** Presets the person sheet offers: partial engine specs. */
export const PRESETS = [
  { id: 'seeded', name: 'Seeded (default)', spec: null },
  { id: 'classic', name: 'Classic', spec: { kind: 'person', hair: 'flat', accessory: 'none', face: 'none', held: 'none', head: 'none' } },
  { id: 'glasses', name: 'Glasses', spec: { kind: 'person', hair: 'side', accessory: 'glasses' } },
  { id: 'cap', name: 'Cap', spec: { kind: 'person', head: 'cap' } },
  { id: 'beard', name: 'Beard', spec: { kind: 'person', hair: 'tall', face: 'beard' } },
  { id: 'long', name: 'Long hair', spec: { kind: 'person', hair: 'long' } },
  { id: 'headset', name: 'Headset', spec: { kind: 'person', head: 'headset' } },
  { id: 'laptop', name: 'Laptop', spec: { kind: 'person', held: 'laptop' } },
  { id: 'coffee', name: 'Coffee', spec: { kind: 'person', held: 'coffee' } },
  { id: 'hoodie', name: 'Hoodie', spec: { kind: 'person', outfit: 'hoodie' } },
  { id: 'suit', name: 'Suit', spec: { kind: 'person', outfit: 'suit', accessory: 'bowtie' } },
  { id: 'tophat', name: 'Top hat', spec: { kind: 'person', head: 'tophat' } },
  { id: 'cat', name: 'Cat', spec: { kind: 'cat' } },
  { id: 'dog', name: 'Dog', spec: { kind: 'dog' } },
  { id: 'robot', name: 'Robot', spec: { kind: 'robot' } },
]
export const presetById = id => PRESETS.find(p => p.id === id) || null

/** Seeded look for a name, then the person's own choices on top (legacy keys, engine keys, a code, or a preset). */
export function avatarSpec(name, custom, shirt) {
  const base = K.seededSpec(name, { shirt })
  const over = customToEngine(custom)
  const spec = K.normalizeSpec({ ...base, ...over })
  if (shirt && isHex(shirt) && !over.shirt) spec.shirt = shirt
  return spec
}

/** Floorplan's avatar field -> engine-key partial. Accepts the old 12x12 keys, engine keys, `code`, `preset`, or a kind string. */
export function customToEngine(c) {
  if (!c) return {}
  if (typeof c === 'string') {
    if (c.startsWith(K.CODE_PREFIX)) return K.codeToSpec(c) || {}
    const p = presetById(c); if (p) return p.spec || {}
    return KINDS.includes(c) ? { kind: c } : {}
  }
  if (typeof c !== 'object') return {}
  let out = {}
  if (c.code) Object.assign(out, K.codeToSpec(c.code) || {})
  if (c.preset) Object.assign(out, customToEngine(String(c.preset)))
  for (const slot of K.SLOTS) if (c[slot] != null && K.CATALOG[slot].some(p => p.id === c[slot])) out[slot] = c[slot]
  // legacy keys from the 12x12 era
  if (c.hair !== undefined && !K.CATALOG.hair.some(p => p.id === c.hair)) {
    const i = typeof c.hair === 'number' ? c.hair : HAIR_STYLES.indexOf(String(c.hair))
    if (i >= 0 && i < 4) out.hair = HAIR_STYLES[i]
    if (i === 4 || c.hair === 'cap') { out.hair = out.hair || 'flat'; out.head = 'cap' }
  }
  if (c.glasses === true) out.accessory = 'glasses'
  if (c.beard === true) out.face = 'beard'
  if (c.item === 'laptop' || c.item === 'coffee') out.held = c.item
  if (c.item === 'headset') out.head = 'headset'
  if (c.item === 'hat') out.head = 'tophat'
  for (const k of ['skin', 'coat', 'hairColor', 'shirt']) {
    if (isHex(c[k])) out[k] = String(c[k]).toLowerCase()
    else if (c[k] !== undefined && c[k] !== null && c[k] !== '' && !isNaN(Number(c[k]))) { const arr = k === 'skin' ? SKIN : k === 'coat' ? COAT : HAIR; if (arr[Number(c[k])]) out[k] = arr[Number(c[k])] }
  }
  return out
}

/** Cached data URL for (name, shirt, custom). Drawn at 1x; CSS scales it by whole numbers. */
export function avatarDataUrl(name, shirt, custom = null) {
  return K.spriteDataUrl(avatarSpec(name, custom, shirt), 1)
}

/** Markup for one sprite; `px` is the rendered size in CSS pixels (multiples of 16 stay crisp). */
export function avatarImg(name, shirt, { px = 32, cls = '', custom = null } = {}) {
  return `<img class="px-avatar ${cls}" src="${avatarDataUrl(name, shirt, custom)}" alt="" width="${px}" height="${px}" draggable="false" data-svg="img">`
}

/** Placeholder for an open seat: a dashed desk outline, or a pet waiting for its human. */
const vacantCache = new Map()
export function vacantImg(px = 32, placeholder = 'desk') {
  if (placeholder === 'cat' || placeholder === 'dog') {
    const url = K.spriteDataUrl({ ...K.defaultSpec(), kind: placeholder, coat: placeholder === 'cat' ? '#9ca3af' : '#a8703a', shirt: '#475569' }, 1)
    return `<img class="px-avatar px-avatar--vacant px-avatar--pet" src="${url}" alt="" width="${px}" height="${px}" draggable="false">`
  }
  if (!vacantCache.has('desk')) {
    const c = document.createElement('canvas'); c.width = AV; c.height = AV
    const ctx = c.getContext('2d')
    ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.setLineDash([1, 1]); ctx.lineWidth = 1
    ctx.strokeRect(5.5, 3.5, 5, 5); ctx.strokeRect(3.5, 10.5, 9, 4)
    vacantCache.set('desk', c.toDataURL('image/png'))
  }
  return `<img class="px-avatar px-avatar--vacant" src="${vacantCache.get('desk')}" alt="" width="${px}" height="${px}" draggable="false">`
}

/** The visitor's own character from the fleet cookie, or null. */
export function myCharacter() { return K.readCharacter() }
export const { specToCode, codeToSpec, spriteDataUrl, readUnlocks, normalizeSpec } = K

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
