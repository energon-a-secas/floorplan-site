// ════════════════════════════════════════════════════════════
//  image-export.js: SVG and PNG of whatever the board shows. One builder
//  for both views: it walks the live DOM for elements tagged data-svg and
//  emits rects, text and images at their measured positions, so the export
//  cannot drift from the screen (the fleet rule, from pathfinder-site and
//  sortie-site). PNG rasterizes that SVG at 2x through an Image + canvas.
//  Web fonts are not embedded: the pixel font falls back in the file.
// ════════════════════════════════════════════════════════════

import { state } from './state.js'
import { getLayout } from './render.js'
import { escHtml, downloadBlob, showToast, slug } from './utils.js'

const PAD = 24
const f = n => (Math.round(n * 10) / 10).toString()
const num = v => parseFloat(v) || 0
const isClear = c => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c)

export function buildSvg() {
  const root = document.querySelector('#board [data-svg="root"]')
  if (!root) return null
  const base = root.getBoundingClientRect()
  if (!base.width || !base.height) return null
  const W = Math.ceil(base.width + PAD * 2), H = Math.ceil(base.height + PAD * 2 + 22)
  const bodyCs = getComputedStyle(document.body)
  const rootBg = getComputedStyle(root).backgroundColor
  const parts = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${escHtml(bodyCs.fontFamily)}">`)
  parts.push(`<rect width="${W}" height="${H}" fill="${isClear(rootBg) ? bodyCs.backgroundColor || '#040714' : rootBg}"/>`)

  root.querySelectorAll('[data-svg]').forEach(el => {
    const role = el.dataset.svg
    if (role === 'root' || role === 'owns') return
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return
    const x = r.left - base.left + PAD, y = r.top - base.top + PAD
    const cs = getComputedStyle(el)
    if (role === 'img') {
      const src = el.currentSrc || el.src
      if (src) parts.push(`<image href="${escHtml(src)}" x="${f(x)}" y="${f(y)}" width="${f(r.width)}" height="${f(r.height)}" preserveAspectRatio="none" style="image-rendering:pixelated;image-rendering:crisp-edges"/>`)
      return
    }
    if (role === 'bar') {
      const pct = num(el.style.getPropertyValue('--p')) || 100
      const fillEl = el.querySelector('.pct-fill')
      const fill = fillEl ? getComputedStyle(fillEl).backgroundColor : '#64748b'
      parts.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(r.width)}" height="${f(r.height)}" fill="${cs.backgroundColor}" stroke="${cs.borderTopColor}" stroke-width="1"/>`)
      parts.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(r.width * pct / 100)}" height="${f(r.height)}" fill="${fill}"/>`)
      return
    }
    if (role === 'disc') {
      parts.push(`<circle cx="${f(x + r.width / 2)}" cy="${f(y + r.height / 2)}" r="${f(r.width / 2)}" fill="${cs.backgroundColor}"/>`)
      pushText(parts, el, cs, x, y, r, { center: true })
      return
    }
    // box, door, tag, badge
    const fill = cs.backgroundColor, stroke = cs.borderTopColor, sw = num(cs.borderTopWidth)
    const rx = Math.min(num(cs.borderTopLeftRadius), r.height / 2)
    if (!isClear(fill) || (sw && !isClear(stroke))) {
      parts.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(r.width)}" height="${f(r.height)}" rx="${f(rx)}" fill="${isClear(fill) ? 'none' : fill}"${sw && !isClear(stroke) ? ` stroke="${stroke}" stroke-width="${sw}"` : ''}/>`)
    }
    const lw = num(cs.borderLeftWidth)
    if (lw > sw && !isClear(cs.borderLeftColor)) parts.push(`<rect x="${f(x)}" y="${f(y)}" width="${lw}" height="${f(r.height)}" fill="${cs.borderLeftColor}"/>`)
    const bw = num(cs.borderBottomWidth)
    if (bw > sw && !isClear(cs.borderBottomColor)) parts.push(`<rect x="${f(x)}" y="${f(y + r.height - bw)}" width="${f(r.width)}" height="${bw}" fill="${cs.borderBottomColor}"/>`)
    if (role === 'tag' || role === 'badge') pushText(parts, el, cs, x, y, r, { center: true })
    if (role === 'text') pushText(parts, el, cs, x, y, r, {})
  })

  // corridors from the layout (cells -> px through the measured layer)
  const layout = getLayout()
  const layer = root.querySelector('.building-layer')
  if (layout && layer && layout.corridors.length) {
    const lr = layer.getBoundingClientRect()
    const cell = lr.width / layout.cols
    const ox = lr.left - base.left + PAD, oy = lr.top - base.top + PAD
    for (const c of layout.corridors) {
      const d = c.points.map((p, i) => `${i ? 'L' : 'M'}${f(ox + p[0] * cell)} ${f(oy + p[1] * cell)}`).join(' ')
      parts.push(`<path d="${d}" fill="none" stroke="rgba(148,163,184,.8)" stroke-width="3" stroke-dasharray="8 6" stroke-linejoin="round"/>`)
      if (c.label) {
        const a = c.points[Math.floor(c.points.length / 2) - 1], b = c.points[Math.floor(c.points.length / 2)]
        parts.push(`<text x="${f(ox + (a[0] + b[0]) / 2 * cell)}" y="${f(oy + (a[1] + b[1]) / 2 * cell - 6)}" font-size="11" font-weight="600" text-anchor="middle" fill="rgba(226,232,240,.9)">${escHtml(c.label)}</text>`)
      }
    }
  }

  const title = (state.meta.title || '').trim()
  parts.push(`<text x="${PAD}" y="${H - 8}" font-size="11" fill="rgba(148,163,184,.9)">${escHtml(title ? title + ' · ' : '')}floorplan.neorgon.com</text>`)
  parts.push('</svg>')
  return { svg: parts.join(''), width: W, height: H }
}

function pushText(parts, el, cs, x, y, r, { center = false } = {}) {
  let text = (el.textContent || '').replace(/\s+/g, ' ').trim()
  if (!text) return
  if (cs.textTransform === 'uppercase') text = text.toUpperCase()
  const size = num(cs.fontSize) || 12
  const weight = cs.fontWeight
  const fill = cs.color
  const anchorCenter = center || cs.textAlign === 'center'
  const est = text.length * size * 0.56
  if (est > r.width + 2 && text.length > 4) text = text.slice(0, Math.max(3, Math.floor(r.width / (size * 0.56)) - 1)) + '…'
  const lines = wrapIfTall(text, size, r)
  const tx = anchorCenter ? x + r.width / 2 : x + num(cs.paddingLeft)
  const lh = size * 1.2
  const totalH = lines.length * lh
  const y0 = y + (r.height - totalH) / 2 + lh * 0.8
  const fam = cs.fontFamily && cs.fontFamily !== getComputedStyle(document.body).fontFamily ? ` font-family="${escHtml(cs.fontFamily)}"` : ''
  const ls = cs.letterSpacing && cs.letterSpacing !== 'normal' ? ` letter-spacing="${num(cs.letterSpacing)}"` : ''
  parts.push(`<text x="${f(tx)}" y="${f(y0)}" font-size="${f(size)}" font-weight="${weight}" fill="${fill}"${anchorCenter ? ' text-anchor="middle"' : ''}${fam}${ls}>`
    + lines.map((ln, i) => `<tspan x="${f(tx)}" dy="${i ? f(lh) : 0}">${escHtml(ln)}</tspan>`).join('') + '</text>')
}

function wrapIfTall(text, size, r) {
  if (r.height < size * 2.2) return [text]
  const perLine = Math.max(3, Math.floor(r.width / (size * 0.56)))
  const words = text.split(' '), lines = []
  let line = ''
  for (const w of words) {
    if (!line) line = w
    else if ((line + ' ' + w).length <= perLine) line += ' ' + w
    else { lines.push(line); line = w }
  }
  if (line) lines.push(line)
  return lines.slice(0, Math.max(1, Math.floor(r.height / (size * 1.2))))
}

const fname = ext => `${slug(state.meta.title || 'floorplan')}-${state.meta.mode}.${ext}`

export function exportSVG() {
  const built = buildSvg()
  if (!built) { showToast('Nothing to export yet'); return }
  downloadBlob(new Blob([built.svg], { type: 'image/svg+xml' }), fname('svg'))
  showToast(state.meta.mode === 'building' ? 'SVG exported (pixel font falls back to system)' : 'SVG exported')
}

export function exportPNG(scale = 2) {
  const built = buildSvg()
  if (!built) { showToast('Nothing to export yet'); return }
  const { svg, width, height } = built
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale)
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.drawImage(img, 0, 0)
    canvas.toBlob(blob => {
      if (!blob) { showToast('PNG export failed, try SVG'); return }
      downloadBlob(blob, fname('png'))
      showToast(`PNG exported (${scale}x)`)
    }, 'image/png')
  }
  img.onerror = () => showToast('PNG export failed, try SVG')
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}
