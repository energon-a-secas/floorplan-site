// ════════════════════════════════════════════════════════════
//  markdown.js: three things, no dependency.
//  renderMarkdown(src)  escape-first subset renderer for notes
//  parseOutline(md)     a pasted outline -> document tree (## Group, - Name)
//  rosterMarkdown()     the board as an outline in the same syntax, so an
//                       export pastes back in unchanged
//
//  Safety model (same as agentlore-site and cadrage-site): the source is
//  HTML-escaped FIRST, then a fixed whitelist of patterns is promoted back
//  to tags. The regexes only ever turn safe text into safe markup.
// ════════════════════════════════════════════════════════════

import { escHtml, fmtFte } from './utils.js'
import { state, allGroups, topGroups, bands, childrenOf } from './state.js'
import { groupStats } from './allocation.js'

export function inlineFormat(text) {
  let s = escHtml(text)
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  s = s.replace(/_([^_\n]+)_/g, '<em>$1</em>')
  // links: https only; the href is already escaped text
  s = s.replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
  return s
}

export function renderMarkdown(src) {
  const lines = String(src ?? '').split('\n')
  const out = []
  let i = 0
  const listStack = []
  const closeLists = (to = 0) => { while (listStack.length > to) out.push(listStack.pop() === 'ul' ? '</li></ul>' : '</li></ol>') }

  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      closeLists()
      const code = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) { code.push(lines[i]); i++ }
      i++
      out.push(`<pre class="md-code">${escHtml(code.join('\n'))}</pre>`)
      continue
    }
    const h = line.match(/^(#{1,4})\s+(.+)$/)
    if (h) { closeLists(); const lvl = Math.min(4, h[1].length + 1); out.push(`<h${lvl}>${inlineFormat(h[2].trim())}</h${lvl}>`); i++; continue }
    if (/^(---+|\*\*\*+)\s*$/.test(line)) { closeLists(); out.push('<hr>'); i++; continue }
    if (line.startsWith('>')) {
      closeLists()
      const q = []
      while (i < lines.length && lines[i].startsWith('>')) { q.push(lines[i].replace(/^>\s?/, '')); i++ }
      out.push(`<blockquote>${q.filter(l => l.trim()).map(l => `<p>${inlineFormat(l)}</p>`).join('')}</blockquote>`)
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      closeLists()
      const rows = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(splitRow(lines[i])); i++ }
      const hasHeader = rows.length > 1 && rows[1].every(c => /^:?-{2,}:?$/.test(c.trim()))
      const body = hasHeader ? rows.slice(2) : rows.slice(1)
      out.push('<div class="md-table"><table><thead><tr>' + rows[0].map(c => `<th>${inlineFormat(c)}</th>`).join('') + '</tr></thead><tbody>'
        + body.map(r => '<tr>' + r.map(c => `<td>${inlineFormat(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>')
      continue
    }
    const item = line.match(/^(\s*)([-*]|\d+\.)\s+(.+)$/)
    if (item) {
      const depth = Math.floor(item[1].length / 2) + 1
      const type = item[2] === '-' || item[2] === '*' ? 'ul' : 'ol'
      if (depth > listStack.length) { out.push(`<${type}>`); listStack.push(type) }
      else {
        closeLists(depth)
        if (listStack.length === depth) out.push('</li>')
        if (listStack[depth - 1] !== type) { out.push(listStack.pop() === 'ul' ? '</ul>' : '</ol>'); out.push(`<${type}>`); listStack.push(type) }
      }
      out.push(`<li>${inlineFormat(item[3])}`)
      i++; continue
    }
    closeLists()
    if (line.trim() === '') { i++; continue }
    out.push(`<p>${inlineFormat(line)}</p>`)
    i++
  }
  closeLists()
  return out.join('\n')
}

function splitRow(line) {
  const cells = line.trim().split('|')
  if (cells[0].trim() === '') cells.shift()
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop()
  return cells.map(c => c.trim())
}

// ── Outline import ───────────────────────────────────────────
// # Title
// ## Group name            (shared: Group A, Group B)  -> a band spanning A and B
// ### Sub-group
// - Name (50%) @Location   any order of the two suffixes; both optional
export function parseOutline(md) {
  const doc = { title: '', groups: [], bands: [] }
  const stack = []   // [{ level, node }]
  let current = null
  for (const rawLine of String(md ?? '').split('\n')) {
    const line = rawLine.replace(/\s+$/, '')
    const h = line.match(/^(#{1,4})\s+(.+)$/)
    if (h) {
      const level = h[1].length
      let text = h[2].replace(/\*\*/g, '').trim()
      if (level === 1 && !doc.title) { doc.title = text; continue }
      const shared = text.match(/\((?:shared|spans?|band)\s*:\s*([^)]+)\)\s*$/i)
      const stats = text.match(/\s*\((\d+)\s+(?:people|person)[^)]*\)\s*$/i)
      if (stats) text = text.slice(0, stats.index).trim()
      if (shared) {
        const node = { name: text.slice(0, shared.index).trim(), spans: shared[1].split(',').map(s => s.trim()).filter(Boolean), members: [] }
        doc.bands.push(node)
        current = node
        stack.length = 0
        continue
      }
      const node = { name: text, members: [], groups: [] }
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
      if (!stack.length) doc.groups.push(node)
      else stack[stack.length - 1].node.groups.push(node)
      stack.push({ level, node })
      current = node
      continue
    }
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/)
    if (bullet && current) {
      let text = bullet[1].replace(/\*\*/g, '').trim()
      let pct = null, location = ''
      text = text.replace(/\((\d{1,3})\s*%\)/, (_, n) => { pct = Number(n); return '' })
      text = text.replace(/@\s*([^@()]+)/, (_, l) => { location = l.trim(); return '' })
      const name = text.replace(/\s{2,}/g, ' ').replace(/[,:]\s*$/, '').trim()
      if (!name) continue
      current.members.push(pct == null ? name : { person: name, pct })
      if (location) {
        doc.people = doc.people || []
        if (!doc.people.some(p => p.name === name)) doc.people.push({ name, location })
      }
    }
  }
  // strip empty arrays so the YAML stays tidy
  const tidy = g => { if (!g.members.length) delete g.members; if (g.groups) { g.groups.forEach(tidy); if (!g.groups.length) delete g.groups } }
  doc.groups.forEach(tidy)
  doc.bands.forEach(b => { if (!b.members.length) delete b.members })
  if (!doc.bands.length) delete doc.bands
  if (!doc.title) delete doc.title
  return doc
}

// ── Outline export ───────────────────────────────────────────
export function rosterMarkdown() {
  const out = []
  out.push(`# ${state.meta.title || 'Team map'}`)
  if (state.meta.notes.trim()) out.push('', state.meta.notes.trim())
  const memberLine = m => {
    const p = state.people[m.person]; if (!p) return null
    const bits = [`- ${p.name}`]
    if (m.pct !== 100) bits.push(`(${m.pct}%)`)
    if (p.location) bits.push(`@${p.location}`)
    return bits.join(' ')
  }
  const emit = (g, level) => {
    const s = groupStats(g.id)
    const head = `${'#'.repeat(level)} ${g.name}` + (g.kind === 'band' ? ` (shared: ${g.spans.map(id => state.groups[id]?.name).filter(Boolean).join(', ')})` : '')
    out.push('', head + (s.deep ? ` (${s.deep} people, ${fmtFte(s.fteDeep)} FTE)` : ''))
    if (g.notes.trim()) out.push('', g.notes.trim())
    if (g.owns.length) out.push('', `Owns: ${g.owns.join(', ')}`)
    const lines = g.members.map(memberLine).filter(Boolean)
    if (lines.length) out.push('', ...lines)
    for (const c of childrenOf(g.id)) emit(c, Math.min(6, level + 1))
  }
  for (const g of topGroups()) emit(g, 2)
  for (const b of bands()) emit(b, 2)
  const unassigned = Object.values(state.people).filter(p => !allGroups().some(g => g.members.some(m => m.person === p.id)))
  if (unassigned.length) { out.push('', '## Unassigned', '', ...unassigned.map(p => `- ${p.name}${p.location ? ' @' + p.location : ''}`)) }
  return out.join('\n') + '\n'
}
