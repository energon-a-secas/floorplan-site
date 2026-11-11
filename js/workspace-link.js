// ════════════════════════════════════════════════════════════
//  workspace-link.js: Floorplan on the Neorgon Workspace (vendored kit,
//  js/neorgon-workspace.js; canonical packages/neorgon-ui/workspace/).
//
//  - "Use my team in Floorplan" builds a document from the workspace's people
//    and teams (adapter: workspace-adapter.js). A board with anything on it is
//    replaced only after the visitor says so in #teamDialog; Undo brings it back.
//  - "Save these people to your workspace" sends the current document's
//    people and groups to the Workspace page's review.
//  - The visitor's working hours are Floorplan's core hours (the overlap
//    Insight, the group sheet's strip and Sim's clock).
//  - The gear in the header and the , key open the Settings sheet, whose
//    Floorplan section holds the viewer's own preferences (the tour, the
//    puzzle scores). Display options stay in the document: they travel with links.
//
//  startWorkspace() must run before the tool reads location.hash: a pick's
//  answer (#neo-ws=) is taken and stripped by the kit's init.
// ════════════════════════════════════════════════════════════

import { NeoWorkspace } from './neorgon-workspace.js'
import { state, ui, snapshot, resetTo } from './state.js'
import { normalizeDoc } from './schema.js'
import { afterChange, renderBoard, renderRoster, renderInsights, renderDetail } from './render.js'
import { showToast, $ } from './utils.js'
import { setCoreHours, coreLabel } from './timezones.js'
import { teamToDoc, docToPayload, isBlank, coreFromPrefs } from './workspace-adapter.js'

const TOUR_KEY = 'floorplan-tour-v1'
const BEST_KEY = 'floorplan-puzzle-best'
let ws = null
let pending = null      // the workspace a confirm dialog is about to apply
let hoursNote = null    // the Floorplan section's core-hours line, while the sheet is open

const editable = () => !ui.readonly && !ui.embed

export function startWorkspace() {
  try {
    ws = NeoWorkspace.init({
      tool: 'floorplan',
      name: 'Floorplan',
      onTeam: () => noteTeam(),
      actions: {
        ...(editable() ? { use: { label: 'Use my team in Floorplan', run: workspace => useMyTeam(workspace) } } : {}),
        save: { label: 'Save these people to your workspace', payload: () => docToPayload(state, ws.team().ws) },
      },
      section: { title: 'Floorplan', render: renderSection },
    })
  } catch (err) { console.error('[floorplan] workspace', err); return null }
  applyPrefs(ws.prefs())
  ws.on('prefs', p => { applyPrefs(p); renderInsights(); renderDetail() })
  ws.on('team', () => noteTeam())
  noteTeam()
  return ws
}

/** After the header kit has run: the gear joins .header-actions. */
export function mountWorkspaceGear() {
  if (!ws || ui.embed) return
  ws.mountGear()
  // The header kit built its mobile overflow before the gear existed; let it collapse the gear too.
  try { window.NeoHeader?.syncOverflow?.() } catch { /* an older header kit: the gear stays in the bar */ }
}

function applyPrefs(p) {
  setCoreHours(coreFromPrefs(p))
  if (hoursNote) hoursNote.textContent = hoursText()
}
const hoursText = () => `Core hours are your working hours above, ${coreLabel()} local: they drive the overlap check in Insights, the core-hours strip in a group's details, and who is in during Sim.`

// The empty board and roster offer the team when there is one.
function noteTeam() {
  const t = ws ? ws.team() : null
  const next = t && t.ws && editable() ? { people: t.ws.people.length, teams: t.ws.teams.length } : null
  const same = JSON.stringify(next) === JSON.stringify(ui.team || null)
  ui.team = next
  if (!same && isBlank(state)) { renderBoard(); renderRoster() }
}

/** The empty-state button. */
export function useTeamFromPage() {
  const t = ws && ws.team()
  if (t && t.ws) useMyTeam(t.ws)
  else if (ws) ws.open({ invoker: document.activeElement })
}

export function useMyTeam(workspace) {
  if (!editable()) { showToast('Read-only view. Open it in Floorplan to edit'); return }
  if (ui.preview) { showToast('Viewing a snapshot. Back to now first'); return }
  if (!workspace || !workspace.people || !workspace.people.length) { showToast('Your workspace has nobody in it yet. Add people on your workspace page'); return }
  if (isBlank(state)) { apply(workspace); return }
  pending = workspace
  // The Settings sheet closes after its button runs this; open ours once it has.
  setTimeout(() => {
    const dlg = $('teamDialog'); if (!dlg) return
    const n = workspace.people.length, m = workspace.teams.length
    const text = $('teamDialogText')
    if (text) text.textContent = `Your team (${n} ${n === 1 ? 'person' : 'people'}${m ? `, ${m} ${m === 1 ? 'team' : 'teams'}` : ''}) replaces ${state.meta.title ? `"${state.meta.title}"` : 'the map on the board'}. Undo (Cmd/Ctrl+Z) brings the current map back.`
    if (!dlg.open) dlg.showModal()
    dlg.querySelector('[data-action="team-replace"]')?.focus()
  }, 0)
}

/** The dialog's Replace button. */
export function confirmTeam() {
  const dlg = $('teamDialog'); if (dlg?.open) dlg.close()
  if (pending) apply(pending)
  pending = null
}

function apply(workspace) {
  const { model, errors } = normalizeDoc(teamToDoc(workspace))
  snapshot()
  resetTo(model)
  ui.selection = null; ui.picked = null; ui.errors = errors; ui.warnings = []
  afterChange()
  const n = Object.keys(model.people).length
  showToast(`Your team is on the board: ${n} ${n === 1 ? 'person' : 'people'}. Cmd/Ctrl+Z brings back what was there`)
  document.querySelector('#board .g-head, #board .room, #rosterList .chip')?.focus?.()
}

// ── The Settings sheet's Floorplan section (DOM by textContent only) ──
function renderSection(el) {
  const el_ = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n }
  hoursNote = el_('p', 'neo-ws-note', hoursText())
  el.append(hoursNote)
  const row = el_('div', 'neo-ws-actions')
  const tour = el_('button', 'neo-ws-btn', 'Show the first-visit tour again')
  tour.type = 'button'
  tour.addEventListener('click', () => {
    try { localStorage.removeItem(TOUR_KEY) } catch { /* blocked: nothing to forget */ }
    document.querySelector('dialog.neo-ws-sheet[open]')?.close()
    import('./tour.js').then(m => { if (!m.startTour()) showToast('The tour cannot run in this view') })
  })
  row.append(tour)
  let best = ''
  try { best = localStorage.getItem(BEST_KEY) || '' } catch { best = '' }
  if (best && best !== '{}') {
    const forget = el_('button', 'neo-ws-btn', 'Forget my puzzle best scores')
    forget.type = 'button'
    forget.addEventListener('click', () => {
      try { localStorage.removeItem(BEST_KEY) } catch { /* blocked */ }
      forget.disabled = true
      forget.textContent = 'Puzzle best scores forgotten'
    })
    row.append(forget)
  }
  el.append(row)
  el.append(el_('p', 'neo-ws-note', 'How seats are drawn (Display in the toolbar) belongs to the document, so a link or an embed looks the same for everyone.'))
}
