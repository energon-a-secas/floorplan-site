// ════════════════════════════════════════════════════════════
//  presence.js: multiplayer presence for Visit mode. While you walk the
//  building, anyone else with the same document open (same #d= link, so
//  the same canonical YAML) shows up as a translucent pixel visitor with
//  a name tag, and you show up in theirs. Ephemeral by design: rows on
//  the server expire ~15s after the last heartbeat; no accounts, no
//  history, nothing lands in the document, localStorage or the exports.
//  Lazy-imported by visit.js when Visit starts. A no-op until CONVEX_URL
//  below is set: without it there is no network, no error and no UI.
//  Client wiring mirrors memes-site (js/state.js there): ConvexHttpClient
//  from the pinned esm.sh build, string function names, no build step.
// ════════════════════════════════════════════════════════════

import { state } from './state.js'
import { emitYaml } from './yaml.js'
import { $, escHtml, plural } from './utils.js'
import { myCharacter, specToCode, codeToSpec, normalizeSpec, spriteDataUrl, avatarDataUrl } from './avatar.js'
import { createPresenceCore, isConfiguredUrl, mapKeyFor, guestName } from './presence-core.js'

// Set after provisioning (npx convex login, then npx convex dev --once here).
// e.g. 'https://brave-otter-123.convex.cloud'. Empty string disables presence.
const CONVEX_URL = ''
// Same pinned browser build memes-site loads; fetched only once presence starts.
const CONVEX_ESM = 'https://esm.sh/convex@1.21.0/browser'

const TICK_MS = 200
let core = null, timer = null, active = false
const els = new Map()            // sessionId -> element on #buildingLayer
let pill = null

/** Called by visit.js when Visit starts. Resolves quietly to false when unconfigured. */
export async function startPresence(pos) {
  if (active || !isConfiguredUrl(CONVEX_URL)) return active
  active = true
  let ConvexHttpClient
  try { ({ ConvexHttpClient } = await import(CONVEX_ESM)) }
  catch { active = false; return false }
  if (!active || core) return active   // stopped (or restarted) while the module loaded
  const client = new ConvexHttpClient(CONVEX_URL)
  const sessionId = crypto.randomUUID()
  const mine = myCharacter()
  core = createPresenceCore({
    client,
    mapKey: mapKeyFor(emitYaml(state).text),
    sessionId,
    name: guestName(sessionId),
    spec: mine ? specToCode(mine) : null,
    x: pos?.x ?? 0,
    y: pos?.y ?? 0,
    onOthers: renderOthers,
  })
  timer = setInterval(() => { core?.tick(Date.now()) }, TICK_MS)
  document.addEventListener('floorplan:board', onBoard)
  window.addEventListener('pagehide', onPageHide)
  return true
}

/** Called by visit.js when Visit stops. Safe to call twice. */
export function stopPresence() {
  if (!active) return
  active = false
  clearInterval(timer); timer = null
  document.removeEventListener('floorplan:board', onBoard)
  window.removeEventListener('pagehide', onPageHide)
  for (const el of els.values()) el.remove()
  els.clear()
  pill?.remove(); pill = null
  core?.stop()                    // fire and forget; the TTL covers a lost request
  core = null
}

/** Called by visit.js after every accepted step. */
export function reportMove(x, y) { core?.move(x, y) }

function onPageHide() { core?.stop() }

/** The board recreates #buildingLayer on every render: re-adopt our elements. */
function onBoard() {
  const layer = $('buildingLayer'); if (!layer) return
  for (const el of els.values()) layer.appendChild(el)
}

// ── Rendering ────────────────────────────────────────────────
function renderOthers(rows) {
  if (!active) return
  const layer = $('buildingLayer')
  const seen = new Set()
  for (const r of rows) {
    seen.add(r.sessionId)
    let el = els.get(r.sessionId)
    if (!el) {
      el = buildRemote(r)
      els.set(r.sessionId, el)
    }
    if (layer && !el.isConnected) layer.appendChild(el)
    if (el.dataset.spec !== (r.spec || '')) {
      el.dataset.spec = r.spec || ''
      el.querySelector('img').src = remoteSprite(r)
    }
    const prevX = Number(el.style.getPropertyValue('--x'))
    if (Number.isFinite(prevX) && prevX !== r.x) el.classList.toggle('face-left', r.x < prevX)
    el.style.setProperty('--x', r.x)
    el.style.setProperty('--y', r.y)
  }
  for (const [id, el] of els) if (!seen.has(id)) { el.remove(); els.delete(id) }
  updatePill(seen.size)
}

function buildRemote(r) {
  const el = document.createElement('div')
  el.className = 'visitor visitor--remote'   // no data-svg role: never in exports
  el.dataset.presence = r.sessionId
  el.dataset.spec = r.spec || ''
  el.setAttribute('aria-hidden', 'true')
  el.innerHTML = `<img src="${remoteSprite(r)}" width="32" height="32" alt=""><span class="visitor-tag">${escHtml(tagName(r))}</span>`
  return el
}

function tagName(r) { return String(r.name || 'guest').slice(0, 24) }

function remoteSprite(r) {
  if (r.spec) {
    const spec = codeToSpec(r.spec)
    if (spec) return spriteDataUrl(normalizeSpec(spec), 1)
  }
  return avatarDataUrl(tagName(r), '#94a3b8')
}

function updatePill(n) {
  if (!n) { pill?.remove(); pill = null; return }
  if (!pill || !pill.isConnected) {
    pill = document.createElement('div')
    pill.className = 'presence-pill'
    pill.setAttribute('role', 'status')
    document.body.appendChild(pill)
  }
  pill.textContent = plural(n, 'other') + ' here'
}
