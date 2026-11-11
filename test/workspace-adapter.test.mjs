// Floorplan's Workspace adapter: the model to a save payload and a workspace back
// to a document, through the vendored kit and Floorplan's own normalizeDoc.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as W from '../js/neorgon-workspace-core.js'
import { normalizeDoc } from '../js/schema.js'
import { teamToDoc, docToPayload, isBlank, coreFromPrefs, faceOf, PREFIX } from '../js/workspace-adapter.js'
import { coreOverlap, setCoreHours, coreHours } from '../js/timezones.js'

const sample = () => W.normalizeWorkspace({
  v: 1,
  me: { person: 'ana-rojas' },
  people: [
    { id: 'ana-rojas', name: 'Ana Rojas', title: 'EM', email: 'ana@example.com', tz: 'America/Santiago', country: 'CL', tags: ['go', 'sre'], color: '#0f766e', avatar: 'neoav1:abc_DEF-1' },
    { id: 'ben', name: 'Ben Okafor', location: 'Lagos', tz: '+1' },
    { id: 'kai', name: 'Kai 王' },
  ],
  teams: [
    { id: 'payments', name: 'Payments', lead: 'ana-rojas', color: '#be185d', members: [{ person: 'ana-rojas' }, { person: 'ben', pct: 50 }] },
    { id: 'platform', name: 'Platform', members: [{ person: 'ben', pct: 50 }] },
  ],
}).ws

test('a workspace becomes a document normalizeDoc accepts without errors', () => {
  const { model, errors, warnings } = normalizeDoc(teamToDoc(sample()))
  assert.deepEqual(errors, [])
  assert.deepEqual(warnings, [])
  assert.equal(model.meta.title, 'My team')
  assert.deepEqual(Object.keys(model.people).sort(), ['ana-rojas', 'ben', 'kai'])
  const ana = model.people['ana-rojas']
  assert.equal(ana.role, 'EM')
  assert.equal(ana.tz, 'America/Santiago')
  assert.deepEqual(ana.tags, ['go', 'sre'])
  assert.equal(ana.color, '#0f766e')
  assert.deepEqual(ana.avatar, { code: 'neoav1:abc_DEF-1' })
  assert.equal(model.groups.payments.color, '#be185d')
  assert.equal(model.groups.payments.notes, 'Lead: Ana Rojas')
  assert.deepEqual(model.groups.payments.members, [{ person: 'ana-rojas', pct: 100 }, { person: 'ben', pct: 50 }])
  assert.deepEqual(model.groups.platform.members, [{ person: 'ben', pct: 50 }])
})

test('hostile workspace values never reach the document unchecked', () => {
  const doc = teamToDoc({ people: [{ id: 'x', name: '<img src=x onerror=alert(1)>', color: 'red;background:url(x)', avatar: 'javascript:1', tz: 'Mars/Base' }], teams: [{ name: 'T', members: [{ person: 'nobody' }] }] })
  const p = doc.people[0]
  assert.equal(p.color, undefined)
  assert.equal(p.avatar, undefined)
  assert.equal(p.tz, undefined)
  assert.deepEqual(doc.groups[0].members, [])
  assert.deepEqual(teamToDoc(null).people, [])
  assert.deepEqual(teamToDoc('junk').groups, [])
})

test('a document from the workspace saves back under the same ids, so a second save adds nobody', () => {
  const ws = sample()
  const { model } = normalizeDoc(teamToDoc(ws))
  const payload = docToPayload(model, ws)
  assert.deepEqual(payload.people.map(p => p.id), ['ana-rojas', 'ben', 'kai'])
  assert.deepEqual(payload.teams.map(t => t.id), ['payments', 'platform'])
  const merged = W.previewMerge(ws, payload)
  assert.deepEqual(merged.added, [])
  assert.deepEqual(merged.teams.added, [])
  assert.equal(merged.next.people.find(p => p.id === 'ana-rojas').email, 'ana@example.com')   // what Floorplan does not hold is kept
})

test('people Floorplan made itself carry the floorplan- prefix, and saving twice is stable', () => {
  const { model } = normalizeDoc({
    title: 'Atlas',
    people: [{ name: 'Maya K', location: 'Chile' }, { name: 'Leon V', tz: 'Europe/Budapest' }, { name: 'Aiko T' }, { name: 'Sofia R' }, { name: 'Kwame M' }, { name: 'Elena P' }],
    groups: [{ name: 'Kestrel', members: ['Maya K', { person: 'Leon V', pct: 50 }], groups: [{ name: 'Back End', members: ['Aiko T', 'Sofia R'] }] }, { name: 'Lantern', members: [{ person: 'Leon V', pct: 50 }, 'Kwame M'] }],
    bands: [{ name: 'QA', spans: ['Kestrel', 'Lantern'], members: ['Elena P'] }],
  })
  const payload = docToPayload(model, null)
  assert.ok(payload.people.length > 5)
  assert.ok(payload.people.every(p => p.id.startsWith(PREFIX)))
  assert.ok(payload.teams.every(t => t.id.startsWith(PREFIX)))
  const { ws, issues } = W.normalizeWorkspace(payload)
  assert.deepEqual(issues.filter(i => i.level === 'error'), [])
  const once = W.previewMerge(W.normalizeWorkspace({}).ws, payload).next
  const again = W.previewMerge(once, docToPayload(model, once))
  assert.deepEqual(again.added, [])
  assert.deepEqual(again.teams.added, [])
  assert.equal(ws.people.length, payload.people.length)
  // a prefixed id is not prefixed twice
  const back = normalizeDoc(teamToDoc(once)).model
  assert.ok(docToPayload(back, null).people.every(p => !p.id.startsWith(PREFIX + PREFIX)))
})

test('the payload drops what the workspace would refuse', () => {
  const { model } = normalizeDoc({ people: [{ name: 'Zoe', tz: 'Not/AZone', color: '#abc', avatar: { preset: 'cat' }, tags: ['a'] }], groups: [{ name: 'G', members: ['Zoe'] }] })
  const [p] = docToPayload(model).people
  assert.equal(p.tz, undefined)
  assert.equal(p.color, '#aabbcc')
  assert.equal(p.avatar, undefined)
  assert.deepEqual(p.tags, ['a'])
})

test('isBlank, core hours from prefs, faces', () => {
  assert.equal(isBlank({ people: {}, groups: {} }), true)
  assert.equal(isBlank(normalizeDoc(teamToDoc(sample())).model), false)
  assert.deepEqual(coreFromPrefs({ h: [480, 990] }), { start: 8, end: 16.5 })
  assert.deepEqual(coreFromPrefs({ h: [990, 480] }), { start: 9, end: 17 })
  assert.deepEqual(coreFromPrefs(null), { start: 9, end: 17 })
  const f = faceOf({ id: 'ben', name: 'Ben Okafor' })
  assert.equal(f.color, W.colorFor({ id: 'ben' }))
  assert.equal(f.initials, 'BO')
  assert.equal(faceOf({ id: 'x', name: 'A', color: '#fff' }).ink, '#111111')
})

test('the overlap check follows the core hours the visitor set', () => {
  const people = [{ name: 'A', tz: '+0' }, { name: 'B', tz: '+4' }]
  setCoreHours({ start: 9, end: 17 })
  assert.equal(coreOverlap(people).hours, 4)
  setCoreHours({ start: 8, end: 18 })
  assert.equal(coreOverlap(people).hours, 6)
  setCoreHours({ start: 20, end: 5 })   // refused: start after end
  assert.deepEqual(coreHours(), { start: 8, end: 18 })
  setCoreHours({ start: 9, end: 17 })
})

test('using the team and saving it back unedited changes nothing in the workspace', () => {
  const long = 'Maria de los Angeles Fernandez Gutierrez de la Concepcion Smith'
  const ws = W.normalizeWorkspace({
    v: 1,
    people: [
      { id: 'ana', name: 'Ana Rojas', tags: ['Go', 'SRE'], tz: 'America/Santiago', avatar: 'neoav1:abc_DEF-1' },
      { id: 'longname', name: long, title: 'Staff engineer', location: 'Santiago' },
      { id: 'kai', name: 'Kai Tan', color: '#fde68a', tags: ['ML', 'ml-ops'] },
    ],
    teams: [
      { id: 'core', name: 'Core', members: [{ person: 'ana' }, { person: 'kai', pct: 40 }] },
      { id: 'payments', name: 'Payments', color: '#be185d', members: [{ person: 'longname' }] },
      { id: 'growth', name: 'Growth', members: [{ person: 'kai', pct: 60 }] },
    ],
  }).ws
  const { model } = normalizeDoc(teamToDoc(ws))
  assert.equal(model.people.longname.name, long)
  const payload = docToPayload(model, ws)
  assert.deepEqual(payload.people.find(p => p.id === 'ana').tags, ['Go', 'SRE'])
  assert.equal(payload.teams.find(t => t.id === 'core').color, undefined)
  const merged = W.previewMerge(ws, payload)
  assert.deepEqual(merged.added, [])
  assert.deepEqual(merged.updated, [])
  assert.deepEqual(merged.teams.added, [])
  assert.deepEqual(merged.teams.updated, [])
  // a colour the visitor picked in Floorplan still goes
  model.groups.core.color = '#123456'
  assert.equal(docToPayload(model, ws).teams.find(t => t.id === 'core').color, '#123456')
})

test('two long Floorplan ids that differ only at the end stay two people', () => {
  const base = 'a'.repeat(44)
  const { model } = normalizeDoc({ people: [{ id: base + '-one', name: 'One' }, { id: base + '-two', name: 'Two' }], groups: [{ name: 'G', members: [base + '-one', base + '-two'] }] })
  const payload = docToPayload(model, null)
  const ids = payload.people.map(p => p.id)
  assert.equal(new Set(ids).size, 2)
  assert.ok(ids.every(id => W.isId(id) && id.length <= 48 && id.startsWith(PREFIX)), ids.join())
  assert.equal(W.previewMerge(W.normalizeWorkspace({}).ws, payload).next.people.length, 2)
  assert.deepEqual(payload.teams[0].members.map(m => m.person), ids)
})

test('a document whose id is a workspace id but names someone else is not saved over them', () => {
  const ws = W.normalizeWorkspace({
    v: 1,
    people: [{ id: 'maya', name: 'Maya K', email: 'maya@example.com' }, { id: 'floorplan-ben', name: 'Ben Ito' }],
    teams: [{ id: 'core', name: 'Core', members: [{ person: 'maya' }] }],
  }).ws
  const { model } = normalizeDoc({
    people: [{ id: 'maya', name: 'Bob Stone' }, { id: 'ben', name: 'Rosa Diaz' }],
    groups: [{ id: 'core', name: 'Infra', members: ['maya', 'ben'] }],
  })
  const payload = docToPayload(model, ws)
  const idOf = (name) => payload.people.find(p => p.name === name).id
  assert.notEqual(idOf('Bob Stone'), 'maya')
  assert.ok(idOf('Bob Stone').startsWith(PREFIX))
  assert.ok(!['floorplan-ben', 'maya'].includes(idOf('Rosa Diaz')), idOf('Rosa Diaz'))   // the prefixed id is someone else's too
  assert.notEqual(payload.teams[0].id, 'core')
  const merged = W.previewMerge(ws, payload)
  assert.deepEqual(merged.updated, [])
  assert.deepEqual(merged.teams.updated, [])
  assert.equal(merged.next.people.find(p => p.id === 'maya').name, 'Maya K')
  assert.equal(merged.next.teams.find(t => t.id === 'core').name, 'Core')
  // the same document saved again adds nobody new
  const again = W.previewMerge(merged.next, docToPayload(model, merged.next))
  assert.deepEqual(again.added, [])
  assert.deepEqual(again.teams.added, [])
  // and a name that differs only in case or accents is still the same person
  const same = normalizeDoc({ people: [{ id: 'maya', name: 'MAYA K' }], groups: [] }).model
  assert.equal(docToPayload(same, ws).people[0].id, 'maya')
})

test('a 40-character tag whose lowercase is longer round-trips unchanged', () => {
  const tag = 'İ'.repeat(40)
  assert.ok(tag.toLowerCase().length > 40)
  const ws = W.normalizeWorkspace({ v: 1, people: [{ id: 'ana', name: 'Ana', tags: [tag, 'Go'] }], teams: [] }).ws
  assert.deepEqual(ws.people[0].tags, [tag, 'Go'])
  const { model } = normalizeDoc(teamToDoc(ws))
  const payload = docToPayload(model, ws)
  assert.deepEqual(payload.people[0].tags, [tag, 'Go'])
  const merged = W.previewMerge(ws, payload)
  assert.deepEqual(merged.updated, [])
  // one tag dropped in Floorplan: the other keeps its spelling, the long one too
  model.people.ana.tags = model.people.ana.tags.filter(t => t !== 'go')
  assert.deepEqual(docToPayload(model, ws).people[0].tags, [tag])
})
