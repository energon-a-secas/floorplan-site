/**
 * Browser check for Floorplan on the Neorgon Workspace. Not a node --test file:
 * it needs Playwright (from the monorepo root) and two local servers, which it starts:
 *   Floorplan on FP_TOOL_PORT (9352), neorgon-site on FP_FRAME_PORT (9353) as the frame
 *   and the Workspace page.
 *
 *   node test/workspace-browser.mjs [chromium,webkit]
 *
 * Playwright turns Chromium's storage partitioning off; it is put back here, as in
 * packages/neorgon-ui/tests/workspace-browser.mjs, so a sharing check cannot pass
 * for the wrong reason. Screenshots go to FP_SHOTS when it is set.
 */
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SITE = fileURLToPath(new URL('../', import.meta.url))
const ROOT = join(SITE, '../..')
const require = createRequire(join(ROOT, 'package.json'))
const { chromium, webkit } = require('playwright')
const W = await import('../js/neorgon-workspace-core.js')

const TOOL_PORT = Number(process.env.FP_TOOL_PORT || 9352)
const FRAME_PORT = Number(process.env.FP_FRAME_PORT || 9353)
const servers = [[TOOL_PORT, SITE], [FRAME_PORT, join(ROOT, 'projects/neorgon-site')]]
  .map(([port, dir]) => spawn('python3', [join(ROOT, 'scripts/serve.py'), String(port), dir], { stdio: 'ignore' }))
const stop = () => servers.forEach(s => s.kill())
process.on('exit', stop)
await new Promise(r => setTimeout(r, 900))

const TOOL = `http://localhost:${TOOL_PORT}/`
const FRAME = `http://localhost:${FRAME_PORT}`
const SHOTS = process.env.FP_SHOTS || ''
const engines = (process.argv[2] || 'chromium,webkit').split(',')
let v = Date.now() % 100000
const results = []
const check = (eng, name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${eng}: ${name}${extra && !ok ? ' ' + extra : ''}`) }

const team = () => W.normalizeWorkspace({
  v: 1,
  people: [
    { id: 'ana', name: 'Ana Rojas', tz: 'America/Santiago', title: 'EM' },
    { id: 'ben', name: 'Ben <img src=x onerror=alert(1)> Okafor', tz: '+1' },
    { id: 'kai', name: 'Kai Tan', color: '#fde68a' },
  ],
  teams: [{ id: 'payments', name: 'Payments <b>x</b>', members: [{ person: 'ana' }, { person: 'ben', pct: 50 }] }, { id: 'core', name: 'Core', members: [{ person: 'kai' }] }],
}).ws

async function launch(eng) {
  if (eng !== 'chromium') return webkit.launch()
  const probe = await chromium.launch({ args: ['--enable-automation'] })
  const cdp = await probe.newBrowserCDPSession()
  const cmd = (await cdp.send('Browser.getBrowserCommandLine')).arguments.join(' ')
  await probe.close()
  const arg = (cmd.match(/--disable-features=\S+/) || [])[0]
  if (!arg) return chromium.launch()
  return chromium.launch({ ignoreDefaultArgs: [arg], args: [arg.replace(/(,)?ThirdPartyStoragePartitioning/, '').replace('=,', '=')] })
}

async function go(page, url) {
  for (let i = 0; ; i++) {
    try { return await page.goto(url) } catch (err) {
      if (i >= 3 || !/connect|CONNECTION_REFUSED|reset/i.test(String(err))) throw err
      await page.waitForTimeout(400)
    }
  }
}

const teamState = page => page.evaluate(async () => { const m = await import('/js/neorgon-workspace.js'); const t = m.NeoWorkspace.current.team(); return { status: t.status, frame: t.frame, people: t.ws ? t.ws.people.length : 0 } })
async function waitShared(page) {
  for (let i = 0; i < 60; i++) { const s = await teamState(page); if (s.status === 'shared') return s; await page.waitForTimeout(100) }
  return teamState(page)
}

for (const eng of engines) {
  const browser = await launch(eng)
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(([o, port]) => { try { if (location.port === port) { localStorage.setItem('floorplan-tour-v1', '1'); localStorage.setItem('neo-ws:dev-origin', o) } } catch { /* none */ } }, [FRAME, String(TOOL_PORT)])
  const errors = []
  ctx.on('page', p => {
    p.on('pageerror', e => errors.push(String(e)))
    p.on('console', m => { if (m.type() === 'error' && !/Content Security Policy.*style|stylesheet/i.test(m.text())) errors.push(m.text()) })
  })
  try {
    // Seed neorgon.com's copy (the frame's origin) and the stamp cookie (host-only on localhost).
    const stamp = W.makeStamp()
    const seed = await ctx.newPage()
    await go(seed, `${FRAME}/workspace/vault.html?v=${++v}`)
    await seed.evaluate(([rec, cookie]) => { localStorage.setItem('neo-ws:workspace', JSON.stringify(rec)); document.cookie = cookie },
      [{ __v: 1, data: { stamp, ws: team() } }, W.stampCookie(stamp, { protocol: 'http:', hostname: 'localhost' })])
    await seed.close()

    const page = await ctx.newPage()
    await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI)) })
    await go(page, `${TOOL}?v=${++v}`)
    const s = await waitShared(page)
    check(eng, 'the frame answers shared through the CSP', s.status === 'shared' && s.people === 3, JSON.stringify(s))
    const csp = await page.evaluate(() => window.__csp)
    check(eng, 'no CSP violation', !csp.some(x => /frame|script/.test(x)), JSON.stringify(csp))

    // The Settings button and the , key. Floorplan's own button, not the kit's gear.
    const gear = page.locator('.header-actions #settingsBtn')
    check(eng, 'Settings sits in .header-actions and names the , key', await gear.count() === 1 && await gear.getAttribute('aria-keyshortcuts') === ',' && await page.locator('.neo-ws-gear').count() === 0)
    check(eng, 'the Settings button is named Settings', (await gear.getAttribute('aria-label') || (await gear.textContent()).trim()) === 'Settings')
    await gear.click()
    check(eng, 'the Settings button opens Settings', await page.locator('dialog.neo-ws-sheet[open]').count() === 1)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)
    await page.locator('#board').click({ position: { x: 4, y: 4 } })
    await page.keyboard.press(',')
    const sheet = page.locator('dialog.neo-ws-sheet[open]')
    check(eng, ', opens Settings', await sheet.count() === 1)
    const sectionText = await sheet.innerText()
    check(eng, 'the Floorplan section shows the core hours', /Core hours are your working hours above, 09:00 to 17:00/.test(sectionText), sectionText.slice(0, 300))
    check(eng, 'team names are text, never markup', await sheet.locator('b, img').count() === 0)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/floorplan-${eng}-settings.png` })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(100)
    check(eng, 'Escape closes Settings', await sheet.count() === 0)

    // Core hours follow the settings.
    await page.evaluate(async () => { const m = await import('/js/neorgon-workspace.js'); m.NeoWorkspace.current.setPrefs({ h: [480, 1080] }) })
    const insights = await page.locator('#insightList').innerText()
    check(eng, 'Insights use the new core hours', !/09:00 to 17:00/.test(insights))
    await page.evaluate(async () => { const m = await import('/js/neorgon-workspace.js'); m.NeoWorkspace.current.setPrefs({ h: null }) })

    // Use my team on a board that has a map: asks first.
    const before = await page.locator('#board .g-name').allInnerTexts()
    await page.keyboard.press(',')
    await page.getByRole('button', { name: 'Use my team in Floorplan' }).click()
    const dlg = page.locator('#teamDialog[open]')
    await dlg.waitFor({ timeout: 2000 })
    check(eng, 'a non-empty board asks before it is replaced', await dlg.count() === 1)
    const box = await dlg.boundingBox()
    const mid = (a, size, view) => Math.abs(a + size / 2 - view / 2) <= 2
    check(eng, 'the replace dialog is centred', !!box && mid(box.x, box.width, 1440) && mid(box.y, box.height, 900), JSON.stringify(box))
    check(eng, 'focus starts on the safe choice', (await page.evaluate(() => document.activeElement?.textContent.trim())) === 'Keep this map')
    await page.getByRole('button', { name: 'Keep this map' }).click()
    check(eng, 'Keep this map keeps it', JSON.stringify(await page.locator('#board .g-name').allInnerTexts()) === JSON.stringify(before))
    await page.keyboard.press(',')
    await page.getByRole('button', { name: 'Use my team in Floorplan' }).click()
    await page.locator('#teamDialog[open]').waitFor()
    await page.getByRole('button', { name: 'Replace with my team' }).click()
    await page.waitForTimeout(200)
    const names = await page.locator('#board .g-name').allInnerTexts()
    check(eng, 'the team is on the board, names as text', names.join('|') === 'Payments <b>x</b>|Core' && await page.locator('#board img[src="x"]').count() === 0, names.join('|'))
    const title = await page.locator('#docTitle').inputValue()
    check(eng, 'the map is titled My team', title === 'My team')
    await page.locator('#board').click({ position: { x: 4, y: 4 } })
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
    check(eng, 'Undo brings the old map back', JSON.stringify(await page.locator('#board .g-name').allInnerTexts()) === JSON.stringify(before))

    // Initials use the kit's face for workspace people.
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z')
    await page.evaluate(async () => { const s = await import('/js/state.js'); const r = await import('/js/render.js'); s.setDisplay('avatars', 'initials'); r.render() })
    const face = await page.locator('#board .seat[data-person="kai"] .face-disc').first().evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, ink: getComputedStyle(el).color, text: el.textContent }))
    check(eng, "a workspace person's own colour, ink and initials", face.bg === 'rgb(253, 230, 138)' && face.ink === 'rgb(17, 17, 17)' && face.text === 'KT', JSON.stringify(face))
    const anaBg = await page.locator('#board .seat[data-person="ana"] .face-disc').first().evaluate(el => getComputedStyle(el).backgroundColor)
    const hex = W.colorFor({ id: 'ana' })
    check(eng, 'a colourless person gets colorFor(id)', anaBg === `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`, anaBg + ' ' + hex)

    // Nothing under 12px in the header and the board, in both views; no desk name clipped.
    // The footer is left out: its 11.5px note and stamp are the Footer Kit's, fleet-wide.
    const tinyText = (pg) => pg.evaluate(() => [...document.querySelectorAll('body *')].filter(el => {
      if (!el.offsetParent || !el.childNodes.length) return false
      if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return false
      if (el.closest('.neo-footer, .visually-hidden, .nav-label')) return false
      return parseFloat(getComputedStyle(el).fontSize) < 12
    }).map(el => el.className + ':' + getComputedStyle(el).fontSize).slice(0, 8))
    const small = await tinyText(page)
    check(eng, 'no reading text under 12px (diagram)', small.length === 0, JSON.stringify(small))

    // Save these people: a link to the Workspace page's review carrying them.
    await page.keyboard.press(',')
    const nav = page.waitForURL(u => u.href.startsWith(`${FRAME}/workspace/`), { timeout: 5000 })
    await page.getByRole('button', { name: 'Save these people to your workspace' }).click()
    await nav
    const got = W.parseFragment(new URL(page.url()).hash, { selfHostname: 'localhost' })
    const pay = got && got.op === 'save' ? W.decodePayload(got.payload) : null
    check(eng, 'save opens the review with the same ids', !!pay && pay.ws.people.map(p => p.id).sort().join() === 'ana,ben,kai' && got.tool === 'floorplan', JSON.stringify(pay && pay.ws.people.map(p => p.id)))

    // An empty board offers the team.
    await go(page, `${TOOL}?v=${++v}`)
    await waitShared(page)
    await page.getByRole('button', { name: 'Clear' }).click()
    const offer = page.locator('#board [data-action="use-team"]')
    check(eng, 'the empty board offers Use my team', await offer.count() === 1)
    await offer.click()
    await page.waitForTimeout(200)
    check(eng, 'an empty board takes the team without asking', await page.locator('#teamDialog[open]').count() === 0 && await page.locator('#board .g-name').count() === 2)

    // Touch: 44px targets in the toolbar at 390.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: eng === 'chromium' })
    await phone.addInitScript(([o]) => { try { localStorage.setItem('floorplan-tour-v1', '1'); localStorage.setItem('neo-ws:dev-origin', o) } catch { /* none */ } }, [FRAME])
    const pp = await phone.newPage()
    await go(pp, `${TOOL}?v=${++v}`)
    await pp.waitForTimeout(600)
    const tiny = await pp.evaluate(() => [...document.querySelectorAll('.board-toolbar button, .roster button, .roster input, #teamDialog button')].filter(el => el.offsetParent).map(el => [el.textContent.trim() || el.getAttribute('aria-label'), el.getBoundingClientRect().height]).filter(([, h]) => h < 44))
    check(eng, 'toolbar and roster controls are 44px on touch', tiny.length === 0, JSON.stringify(tiny))
    check(eng, 'on a phone Settings collapses into the header menu', await pp.locator('.header-overflow-menu #settingsBtn').count() === 1)
    await pp.locator('.header-overflow-toggle').click()
    const word = await pp.locator('.header-overflow-menu #settingsBtn .nav-label').evaluate(e => [e.textContent, e.getBoundingClientRect().width])
    check(eng, 'in the phone menu Settings shows its word', word[0] === 'Settings' && word[1] > 30, JSON.stringify(word))
    await pp.keyboard.press('Escape')
    const chips = await pp.evaluate(() => [...document.querySelectorAll('#rosterList .chip')].slice(0, 2).map(c => Math.round(c.getBoundingClientRect().top)))
    check(eng, 'the phone roster holds two chips to a row', chips.length === 2 && chips[0] === chips[1], JSON.stringify(chips))
    const scroll = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    check(eng, 'no sideways scroll at 390', scroll <= 0, String(scroll))
    await pp.evaluate(() => document.getElementById('teamDialog').showModal())
    const dlgTiny = await pp.evaluate(() => [...document.querySelectorAll('#teamDialog button')].map(el => [el.textContent.trim() || el.getAttribute('aria-label'), el.getBoundingClientRect().height]).filter(([, h]) => h < 44))
    check(eng, 'the replace dialog buttons are 44px on touch', dlgTiny.length === 0, JSON.stringify(dlgTiny))
    await phone.close()

    // The Building view of the Atlas example (a fresh context: no saved map), as at 1440.
    const wide = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await wide.addInitScript(() => { try { localStorage.setItem('floorplan-tour-v1', '1') } catch { /* none */ } })
    const bp = await wide.newPage()
    await go(bp, `${TOOL}?mode=building&v=${++v}`)
    await bp.waitForTimeout(800)
    const smallB = await tinyText(bp)
    check(eng, 'no reading text under 12px (building)', smallB.length === 0, JSON.stringify(smallB))
    const clipped = await bp.evaluate(() => [...document.querySelectorAll('.building .seat-name')].filter(e => e.offsetParent && e.scrollHeight > e.clientHeight + 1).map(e => e.textContent))
    check(eng, 'no desk name is cut off in the building', clipped.length === 0, JSON.stringify(clipped))
    const plate = await bp.locator('.building .seat--compact[data-person] .seat-name').first().evaluate(e => [e.textContent, e.title])
    check(eng, 'a desk shows the short name, the full one in its title', /^\S+ \S\.$/.test(plate[0]) && plate[1].startsWith(plate[0].slice(0, -2)), JSON.stringify(plate))
    const tbH = await bp.locator('.board-toolbar').evaluate(e => e.getBoundingClientRect().height)
    check(eng, 'the building toolbar keeps to two rows at 1440', tbH <= 110, String(tbH))
    await wide.close()

    // An embed loads no workspace frame: a page that embeds Floorplan never reads the visitor's team.
    const emb = await ctx.newPage()
    await go(emb, `${TOOL}?embed=1&v=${++v}`)
    await emb.waitForTimeout(800)
    check(eng, 'an embed loads no workspace frame and shows no Settings', await emb.locator('iframe').count() === 0 && !(await emb.locator('#settingsBtn').isVisible()))
    await emb.close()

    check(eng, 'no page errors', errors.length === 0, JSON.stringify(errors.slice(0, 5)))
  } catch (err) {
    check(eng, 'run', false, String(err && err.stack || err))
  } finally { await browser.close() }
}
stop()
const failed = results.filter(r => !r).length
console.log(`${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
