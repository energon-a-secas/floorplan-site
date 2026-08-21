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

/** The document wrapped as a prompt for an assistant: paste it, state the change, get YAML back. */
export function copyPrompt() {
  const { text } = emitYaml(state)
  const prompt = [
    'Here is a Floorplan team map as YAML. Schema, reuse rules and link format: https://floorplan.neorgon.com/llms.txt',
    '',
    'Task: <describe the change, e.g. "move Leon fully to Team Lantern and add a 3-person Data squad under Revenue Platform">',
    '',
    'Return the complete updated YAML in one code block. Keep every existing id, keep profiles and extends, use pct only for splits,',
    'and end with a https://floorplan.neorgon.com/#d=<base64url of the YAML> link so I can open it.',
    '',
    '```yaml',
    text.trimEnd(),
    '```',
  ].join('\n')
  copyText(prompt).then(ok => showToast(ok ? 'Prompt copied: paste it into Claude with your change' : 'Could not copy: clipboard blocked'))
}

// ── Slides hand-off (Presentation Sage) ──────────────────────
/** One deck: title, numbers, a people slide per group (10 per slide), the shared spaces, a link back. */
export function openAsSlides() {
  const people = Object.values(state.people)
  const tops = topGroups(), bandList = bands()
  const fte = people.reduce((s, p) => s + Math.min(100, Object.values(state.groups).reduce((t, g) => t + (g.members.find(m => m.person === p.id)?.pct || 0), 0)), 0) / 100
  const title = state.meta.title || 'Team map'
  const slides = [{ type: 'title', heading: title, subtitle: `${people.length} people · ${Math.round(fte * 10) / 10} FTE · ${tops.length} groups` }]
  slides.push({ type: 'stats', heading: 'The shape of it', stats: [
    { value: String(people.length), label: 'People' }, { value: String(tops.length), label: 'Groups' },
    { value: String(bandList.length), label: 'Shared spaces' }, { value: String(Math.round(fte * 10) / 10), label: 'FTE' },
  ] })
  const peopleOf = g => { const ids = [g.id, ...childrenOf(g.id).map(c => c.id)]; const out = []; for (const id of ids) for (const m of state.groups[id].members) { const p = state.people[m.person]; if (!p) continue; const role = [p.role || p.location, m.pct !== 100 ? `${m.pct}%` : ''].filter(Boolean).join(' · '); out.push({ name: p.name, role: role || undefined }) } return out }
  const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out }
  for (const g of [...tops, ...bandList]) {
    const ppl = peopleOf(g)
    if (!ppl.length) continue
    const parts = chunk(ppl, 10)
    parts.forEach((part, i) => slides.push({ type: 'people', heading: parts.length > 1 ? `${g.name} (${i + 1}/${parts.length})` : g.name + (g.kind === 'band' ? ' (shared)' : ''), columns: Math.min(5, Math.max(2, Math.ceil(part.length / 2))), people: part.map(x => x.role ? x : { name: x.name }), ...(g.owns?.length && i === 0 ? { note: `Owns: ${g.owns.join(', ')}` } : {}) }))
  }
  const url = location.origin + location.pathname
  slides.push({ type: 'cta', heading: 'The live map', action: 'Open it in Floorplan', subtext: url + ' (Export → Copy share link carries this exact document)' })
  const deck = { presentation: { title, subtitle: 'Team map', footer: 'floorplan.neorgon.com', slides } }
  const yaml = window.jsyaml ? window.jsyaml.dump(deck, { lineWidth: 100, noRefs: true }) : JSON.stringify(deck)
  const link = 'https://slides.neorgon.com/#d=' + b64urlEncode(yaml)
  if (link.length > 32000) { showToast('Deck too large for a link; export YAML and open it in Presentation Sage'); return }
  const w = window.open(link, '_blank', 'noopener')
  if (!w) copyText(link).then(() => showToast('Popup blocked: the slides link is on your clipboard'))
  else showToast('Opening the deck in Presentation Sage')
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
/** Minimal CSV: quotes, doubled quotes, CR/LF. Returns rows of cells. */
function parseCsv(text) {
  const rows = [], row = []; let cell = '', q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += ch; continue }
    if (ch === '"') q = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(c => c.trim())) rows.push([...row]); row.length = 0 }
    else cell += ch
  }
  row.push(cell); if (row.some(c => c.trim())) rows.push(row)
  return rows
}

/** CSV with a header row (name, team, sub, location, role, pct, tz, tags) -> document tree. */
export function csvToDoc(text) {
  const rows = parseCsv(String(text))
  if (rows.length < 2) return { title: '', groups: [] }
  const head = rows[0].map(h => h.trim().toLowerCase())
  const col = (...names) => head.findIndex(h => names.includes(h))
  const cName = col('name', 'person', 'member'), cTeam = col('team', 'group'), cSub = col('sub', 'subteam', 'sub-team', 'subgroup', 'sub-group')
  const cLoc = col('location', 'where', 'country', 'city'), cRole = col('role', 'title'), cPct = col('pct', 'share', 'percent', '%', 'allocation')
  const cTz = col('tz', 'timezone', 'time zone'), cTags = col('tags', 'skills')
  const groups = new Map(), people = []
  for (const r of rows.slice(1)) {
    const name = (r[cName] ?? '').trim(); if (!name) continue
    const person = { name }
    if (cLoc >= 0 && r[cLoc]?.trim()) person.location = r[cLoc].trim()
    if (cRole >= 0 && r[cRole]?.trim()) person.role = r[cRole].trim()
    if (cTz >= 0 && r[cTz]?.trim()) person.tz = r[cTz].trim()
    if (cTags >= 0 && r[cTags]?.trim()) person.tags = r[cTags].split(/[;|,]/).map(x => x.trim()).filter(Boolean)
    const seen = people.find(p => p.name === name)
    if (!seen) people.push(person)
    else {   // a person on several rows (a split): fill blanks, union tags
      for (const k of ['location', 'role', 'tz']) if (!seen[k] && person[k]) seen[k] = person[k]
      if (person.tags) seen.tags = [...new Set([...(seen.tags || []), ...person.tags])]
    }
    const team = cTeam >= 0 ? (r[cTeam] || '').trim() : ''
    if (!team) continue
    if (!groups.has(team)) groups.set(team, { name: team, members: [], subs: new Map() })
    const g = groups.get(team)
    const pctRaw = cPct >= 0 ? String(r[cPct] || '').replace('%', '').trim() : ''
    const pct = pctRaw ? Math.max(1, Math.min(100, Math.round(Number(pctRaw) <= 1 && pctRaw.includes('.') ? Number(pctRaw) * 100 : Number(pctRaw)))) : null
    const member = pct && pct !== 100 ? { person: name, pct } : name
    const sub = cSub >= 0 ? (r[cSub] || '').trim() : ''
    if (sub) { if (!g.subs.has(sub)) g.subs.set(sub, { name: sub, members: [] }); g.subs.get(sub).members.push(member) }
    else g.members.push(member)
  }
  const tree = [...groups.values()].map(g => {
    const o = { name: g.name }
    if (g.members.length) o.members = g.members
    if (g.subs.size) o.groups = [...g.subs.values()]
    return o
  })
  return { people, groups: tree }
}

function detect(text) {
  const t = String(text).trimStart()
  if (t.startsWith('{')) return 'json'
  const first = t.split('\n')[0] || ''
  if ((first.match(/,/g) || []).length >= 1 && /\b(name|person|member)\b/i.test(first) && /\b(team|group|location|role|pct|share)\b/i.test(first)) return 'csv'
  if (/^#{1,4}\s/m.test(t) && !/^\w[\w-]*:\s*(\S|$)/m.test(t.split('\n').find(l => l.trim() && !l.trim().startsWith('#')) || '')) return 'outline'
  if (/^\s*[-*]\s+[^{[]/.test(t) && !/:\s/.test(t.split('\n')[0])) return 'outline'
  return 'yaml'
}

/** Parse without applying (compare baseline). Returns { model, errors, kind }. */
export function parseAny(text, { format = 'auto' } = {}) {
  const kind = format === 'auto' ? detect(text) : format
  const r = kind === 'json' ? parseJson(text) : kind === 'outline' ? normalizeDoc(parseOutline(text)) : kind === 'csv' ? normalizeDoc(csvToDoc(text)) : parseYaml(text)
  return { model: r.model, errors: r.errors, warnings: r.warnings, kind }
}

/** Parse + apply pasted or fetched text. Returns true on success; errors go to the YAML panel. */
export function importText(text, { format = 'auto' } = {}) {
  return applyText(text, { format })
}

function applyText(text, { format = 'auto', silent = false } = {}) {
  const kind = format === 'auto' ? detect(text) : format
  let result
  if (kind === 'json') result = parseJson(text)
  else if (kind === 'outline') result = normalizeDoc(parseOutline(text))
  else if (kind === 'csv') result = normalizeDoc(csvToDoc(text))
  else result = parseYaml(text)
  const { model, errors, warnings } = result
  ui.errors = errors; ui.warnings = warnings
  if (!model || errors.length) {
    // keep what they pasted in the panel, with the errors under it
    ui.yamlOpen = true
    renderToolbar()
    const ta = $('yamlText')
    if (ta && kind !== 'outline' && kind !== 'csv') { ta.value = text; ui.yamlDirty = true }
    renderYamlMessages()
    if (!silent) showToast(`${errors.length || 1} problem${errors.length === 1 ? '' : 's'} in the ${kind}`)
    return false
  }
  snapshot()
  resetTo(model)
  ui.selection = null; ui.picked = null; ui.yamlDirty = false
  if (kind === 'yaml') markYamlInSync(text)
  afterChange()
  if (!silent) showToast(kind === 'outline' || kind === 'csv' ? `${kind === 'csv' ? 'CSV' : 'Outline'} imported: ${Object.keys(model.groups).length} groups, ${Object.keys(model.people).length} people` : 'Imported')
  return true
}

export function importFile(file) {
  const reader = new FileReader()
  reader.onload = () => {
    const name = (file.name || '').toLowerCase()
    const format = name.endsWith('.json') ? 'json' : name.endsWith('.csv') ? 'csv' : name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt') ? 'outline' : 'yaml'
    applyText(String(reader.result || ''), { format })
  }
  reader.onerror = () => showToast('Could not read that file')
  reader.readAsText(file)
}
