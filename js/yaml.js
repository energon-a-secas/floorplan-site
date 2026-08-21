// ════════════════════════════════════════════════════════════
//  yaml.js: text <-> model. js-yaml 4.1.0 is loaded globally by a CDN
//  <script> in index.html (pinned, with SRI). Parsed documents are cloned
//  before normalizing because YAML aliases share object identity, and code
//  that later mutates one alias silently mutates them all (slides-site hit
//  this: every alias got the first slide's number).
// ════════════════════════════════════════════════════════════

import { normalizeDoc, modelToDoc } from './schema.js'

export const YAML_HEADER = '# Floorplan document. Schema and examples: https://floorplan.neorgon.com/llms.txt\n'

export function yamlAvailable() {
  return typeof window !== 'undefined' && !!window.jsyaml
}

function formatYamlError(e) {
  const line = e?.mark?.line
  const reason = e?.reason || e?.message || 'could not read the YAML'
  return Number.isFinite(line) ? `Line ${line + 1}: ${reason}` : String(reason)
}

/** YAML text -> { model, errors, warnings }. model is null only when unparseable. */
export function parseYaml(text) {
  if (!yamlAvailable()) {
    return { model: null, errors: ['YAML support did not load (offline?). Reload the page, or import JSON instead.'], warnings: [] }
  }
  let raw
  try {
    raw = window.jsyaml.load(String(text ?? ''), { schema: window.jsyaml.DEFAULT_SCHEMA })
  } catch (e) {
    return { model: null, errors: [formatYamlError(e)], warnings: [] }
  }
  if (raw == null) raw = {}
  try { raw = structuredClone(raw) } catch { /* exotic values: normalize copies what it reads */ }
  return normalizeDoc(raw)
}

/** JSON text (the same tree shape) -> { model, errors, warnings } */
export function parseJson(text) {
  let raw
  try { raw = JSON.parse(String(text ?? '')) }
  catch (e) { return { model: null, errors: [`JSON: ${e.message}`], warnings: [] } }
  return normalizeDoc(raw)
}

/** model -> { text, flattened } where flattened lists groups whose extends was dropped. */
export function emitYaml(model) {
  const { doc, flattened } = modelToDoc(model)
  let text
  if (yamlAvailable()) {
    text = window.jsyaml.dump(doc, { lineWidth: 100, noRefs: true, quotingType: '"', forceQuotes: false, sortKeys: false })
  } else {
    text = JSON.stringify(doc, null, 2)
  }
  return { text: YAML_HEADER + text, flattened }
}

export function emitJson(model) {
  return JSON.stringify(modelToDoc(model).doc, null, 2)
}
