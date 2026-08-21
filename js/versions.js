// ════════════════════════════════════════════════════════════
//  versions.js: dated snapshots of the whole document, kept inside the
//  document (history: in the YAML) so they travel with links and exports.
//  Preview swaps a snapshot onto the board without touching the working
//  copy (saved in ui.preview.backup, nothing persists while previewing);
//  Restore makes it the working copy (undoable). Compare picks a baseline
//  and diff.js paints the difference.
// ════════════════════════════════════════════════════════════

import { state, ui, resetTo, snapshot as undoSnap } from './state.js'
import { modelToDoc } from './schema.js'
import { afterChange, render } from './render.js'
import { showToast, uid } from './utils.js'
import { versionModel } from './diff.js'

export const today = () => new Date().toISOString().slice(0, 10)
export const isLocked = () => ui.readonly || !!ui.preview

/** The working document as a snapshot-able tree (never nests history). */
function snapshotDoc() {
  const { doc } = modelToDoc(state)
  delete doc.history
  return doc
}

export function takeSnapshot(label = '') {
  if (ui.preview) exitPreview(false)
  undoSnap()
  state.history.push({ id: uid('v'), date: today(), label: String(label).trim().slice(0, 60), doc: snapshotDoc() })
  ui.versionsOpen = true
  afterChange()
  showToast(`Snapshot v${state.history.length} saved (${today()})`)
}

export function deleteSnapshot(index) {
  if (!state.history[index]) return
  if (ui.preview?.index === index) exitPreview(false)
  if (ui.compare?.kind === 'version' && ui.compare.index === index) ui.compare = null
  else if (ui.compare?.kind === 'version' && ui.compare.index > index) ui.compare.index--
  undoSnap()
  state.history.splice(index, 1)
  afterChange()
}

export function enterPreview(index) {
  const entry = state.history[index]; if (!entry) return
  if (ui.preview) exitPreview(false)
  const m = versionModel(entry)
  ui.preview = { index, backup: JSON.stringify({ meta: state.meta, profiles: state.profiles, people: state.people, groups: state.groups, links: state.links }) }
  ui.picked = null; ui.selection = null
  resetTo(structuredClone(m), { keepHistory: true })
  render()
}

export function exitPreview(rerender = true) {
  if (!ui.preview) return
  const back = JSON.parse(ui.preview.backup)
  ui.preview = null
  resetTo(back, { keepHistory: true })
  if (rerender) render()
}

/** Make the previewed snapshot the working document (the snapshot stays in history). */
export function restorePreview() {
  if (!ui.preview) return
  const index = ui.preview.index
  exitPreview(false)
  undoSnap()
  resetTo(structuredClone(versionModel(state.history[index])), { keepHistory: true })
  afterChange()
  showToast(`Restored v${index + 1}. Cmd/Ctrl+Z brings back what was there`)
}

/** base: null | { kind: 'version', index } | { kind: 'external', model, label } */
export function setCompare(base) {
  ui.compare = base
  if (base) { ui.drawerOpen = true; ui.drawerTab = 'changes'; document.body.classList.add('drawer-open') }
  render()
}
