// ════════════════════════════════════════════════════════════
//  export.js: files out (YAML, JSON, Markdown outline, Mermaid), files and
//  pasted text in, and the share link. The link carries the YAML itself:
//  #d=<base64url utf-8 yaml>, mirroring slides-site and proctor-site so an
//  agent that learned one tool can drive this one. ?src=<https url> fetches
//  a hosted document instead. Both are documented in llms.txt.
// ════════════════════════════════════════════════════════════

import { state, ui, snapshot, resetTo, topGroups, bands, childrenOf } from './state.js'
import { emitYaml, emitJson, parseYaml, parseJson } from './yaml.js'
import { rosterMarkdown, parseOutline } from './markdown.js'
import { normalizeDoc } from './schema.js'
import { afterChange, markYamlInSync, renderYamlMessages, renderToolbar } from './render.js'
import { $, downloadText, copyText, showToast, b64urlEncode, b64urlDecode, slug } from './utils.js'

const fname = ext => `${slug(state.meta.title || 'floorplan')}.${ext}`

export function exportYamlFile() { downloadText(emitYaml(state).text, fname('yaml'), 'text/yaml'); showToast('YAML downloaded') }
export function exportJsonFile() { downloadText(emitJson(state), fname('json'), 'application/json'); showToast('JSON downloaded') }
export function exportMarkdownFile() { downloadText(rosterMarkdown(), fname('md'), 'text/markdown'); showToast('Markdown outline downloaded; it pastes back in unchanged') }
export function exportMermaidFile() {
  const text = buildMermaid()
  downloadText(text, fname('mmd'), 'text/plain')
  copyText(text).then(ok => showToast(ok ? 'Mermaid downloaded and copied' : 'Mermaid downloaded'))
}

// ── Mermaid ──────────────────────────────────────────────────
const mid = s => 'n_' + String(s).replace(/[^a-zA-Z0-9]/g, '_')
const q = s => String(s).replace(/"/g, '#quot;')
export function buildMermaid() {
  const out = ['flowchart TB']
  const styles = []
  const emitGroup = (g, indent) => {
    const pad = '  '.repeat(indent)
    out.push(`${pad}subgraph ${mid(g.id)}["${q(g.name)}"]`)
    for (const m of g.members) {
      const p = state.people[m.person]; if (!p) continue
      const label = m.pct === 100 ? p.name : `${p.name} (${m.pct}%)`
      out.push(`${pad}  ${mid(g.id + '__' + p.id)}["${q(label)}"]`)
    }
    for (const c of childrenOf(g.id)) emitGroup(c, indent + 1)
    out.push(`${pad}end`)
    styles.push(`style ${mid(g.id)} fill:${g.color}22,stroke:${g.color}`)
  }
  for (const g of topGroups()) emitGroup(g, 1)
  for (const b of bands()) {
    emitGroup(b, 1)
    for (const s of b.spans) out.push(`  ${mid(b.id)} -. shared .- ${mid(s)}`)
  }
  for (const l of state.links) out.push(`  ${mid(l.from)} ---${l.label ? `|${q(l.label)}|` : ''} ${mid(l.to)}`)
  return [...out, ...styles.map(s => '  ' + s)].join('\n') + '\n'
}

// ── Share link ───────────────────────────────────────────────
export function copyShareLink() {
  const { text } = emitYaml(state)
  const payload = b64urlEncode(text)
  if (payload.length > 32000) { showToast(`Too big for a link (${kb(payload.length)}). Host the YAML and share ?src=<url>`); return }
  const url = location.origin + location.pathname + '#d=' + payload
  copyText(url).then(ok => showToast(ok
    ? (payload.length > 8000 ? `Share link copied (${kb(payload.length)}, big; ?src= travels better)` : `Share link copied (${kb(payload.length)}); the document is in it`)
    : 'Could not copy: clipboard blocked'))
}
const kb = n => (n / 1024).toFixed(1) + ' KB'

/** Load a document the URL carries. Returns true when the URL claimed the load. */
export function loadFromUrl() {
  const hash = location.hash.match(/^#d=(.+)$/)
  if (hash) {
    try {
      const ok = applyText(b64urlDecode(hash[1]), { silent: true })
      history.replaceState(null, '', location.pathname + location.search)
      showToast(ok ? 'Document loaded from the link' : 'The link did not contain a valid document')
    } catch { showToast('The link did not contain a valid document') }
    return true
  }
  const src = new URLSearchParams(location.search).get('src')
  if (src && (/^https:\/\//.test(src) || /^http:\/\/localhost[:/]/.test(src))) {
    fetch(src)
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text() })
      .then(text => { applyText(text); history.replaceState(null, '', location.pathname); showToast('Document loaded from URL') })
      .catch(() => showToast('Could not fetch ?src= (CORS, network, or not https)'))
    return true
  }
  return false
}

// ── Import ───────────────────────────────────────────────────
function detect(text) {
  const t = String(text).trimStart()
  if (t.startsWith('{')) return 'json'
  if (/^#{1,4}\s/m.test(t) && !/^\w[\w-]*:\s*(\S|$)/m.test(t.split('\n').find(l => l.trim() && !l.trim().startsWith('#')) || '')) return 'outline'
  if (/^\s*[-*]\s+[^{[]/.test(t) && !/:\s/.test(t.split('\n')[0])) return 'outline'
  return 'yaml'
}

/** Parse + apply pasted or fetched text. Returns true on success; errors go to the YAML panel. */
export function importText(text, { format = 'auto' } = {}) {
  return applyText(text, { format })
}

function applyText(text, { format = 'auto', silent = false } = {}) {
  const kind = format === 'auto' ? detect(text) : format
  let result
  if (kind === 'json') result = parseJson(text)
  else if (kind === 'outline') { result = normalizeDoc(parseOutline(text)); result.sourceYaml = null }
  else result = parseYaml(text)
  const { model, errors, warnings } = result
  ui.errors = errors; ui.warnings = warnings
  if (!model || errors.length) {
    // keep what they pasted in the panel, with the errors under it
    ui.yamlOpen = true
    renderToolbar()
    const ta = $('yamlText')
    if (ta && kind !== 'outline') { ta.value = text; ui.yamlDirty = true }
    renderYamlMessages()
    if (!silent) showToast(`${errors.length || 1} problem${errors.length === 1 ? '' : 's'} in the ${kind}`)
    return false
  }
  snapshot()
  resetTo(model)
  ui.selection = null; ui.picked = null; ui.yamlDirty = false
  if (kind === 'yaml') markYamlInSync(text)
  afterChange()
  if (!silent) showToast(kind === 'outline' ? `Outline imported: ${Object.keys(model.groups).length} groups, ${Object.keys(model.people).length} people` : 'Imported')
  return true
}

export function importFile(file) {
  const reader = new FileReader()
  reader.onload = () => {
    const name = (file.name || '').toLowerCase()
    const format = name.endsWith('.json') ? 'json' : name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt') ? 'outline' : 'yaml'
    applyText(String(reader.result || ''), { format })
  }
  reader.onerror = () => showToast('Could not read that file')
  reader.readAsText(file)
}
