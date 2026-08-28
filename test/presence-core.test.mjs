// Node tests for the pure half of Visit-mode presence (js/presence-core.js).
// Run: node --test test/   (or: make test)
// The core takes an injected client and an external clock, so heartbeat
// throttling, stale filtering and shutdown are all exercised without a DOM
// and without any network.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createPresenceCore, freshRows, mapKeyFor, guestName, isConfiguredUrl,
  MOVE_MS, IDLE_MS, POLL_MS, TTL_MS,
} from '../js/presence-core.js'

function fakeClient(others = []) {
  const calls = []
  return {
    calls,
    others,
    beats() { return calls.filter(c => c.name === 'presence:heartbeat') },
    polls() { return calls.filter(c => c.name === 'presence:others') },
    leaves() { return calls.filter(c => c.name === 'presence:leave') },
    async mutation(name, args) { calls.push({ name, args }) },
    async query(name, args) { calls.push({ name, args }); return this.others },
  }
}

function makeCore(client, extra = {}) {
  return createPresenceCore({
    client, mapKey: 'mtest', sessionId: 'me', name: 'guest-me', spec: null,
    x: 1, y: 2, onOthers: () => {}, ...extra,
  })
}

test('first tick introduces us immediately with the full row', async () => {
  const client = fakeClient()
  const core = makeCore(client)
  await core.tick(1000)
  assert.equal(client.beats().length, 1)
  assert.deepEqual(client.beats()[0].args, { mapKey: 'mtest', sessionId: 'me', name: 'guest-me', spec: null, x: 1, y: 2 })
})

test('heartbeats while moving are throttled to one per MOVE_MS', async () => {
  const client = fakeClient()
  const core = makeCore(client)
  await core.tick(0)                       // introduction
  for (let t = 100; t <= 1400; t += 100) { // a step every 100ms for 1.4s
    core.move(t / 100, 2)
    await core.tick(t)
  }
  // beats at 0, 600, 1200: the introduction plus one per 600ms window
  assert.equal(client.beats().length, 3)
  const last = client.beats().at(-1).args
  assert.equal(last.x, 12)                 // the latest position, not the one at send-schedule time
})

test('a quiet visitor still keeps alive every IDLE_MS, and no sooner', async () => {
  const client = fakeClient()
  const core = makeCore(client)
  await core.tick(0)
  await core.tick(MOVE_MS + 1)             // not dirty: the move window does not apply
  assert.equal(client.beats().length, 1)
  await core.tick(IDLE_MS - 1)
  assert.equal(client.beats().length, 1)
  await core.tick(IDLE_MS)
  assert.equal(client.beats().length, 2)
})

test('a move after idling beats on the MOVE_MS window, not the idle one', async () => {
  const client = fakeClient()
  const core = makeCore(client)
  await core.tick(0)
  core.move(3, 3)
  await core.tick(MOVE_MS - 1)
  assert.equal(client.beats().length, 1)   // still inside the window
  await core.tick(MOVE_MS)
  assert.equal(client.beats().length, 2)
})

test('moving to the same cell marks nothing dirty', async () => {
  const client = fakeClient()
  const core = makeCore(client)
  await core.tick(0)
  core.move(1, 2)                          // where we already are
  await core.tick(MOVE_MS + 1)
  assert.equal(client.beats().length, 1)
})

test('others are polled every POLL_MS and delivered filtered', async () => {
  const now = 10_000
  const rows = [
    { sessionId: 'a', name: 'guest-a', spec: null, x: 1, y: 1, updatedAt: now },
    { sessionId: 'me', name: 'guest-me', spec: null, x: 9, y: 9, updatedAt: now },      // self
    { sessionId: 'b', name: 'guest-b', spec: null, x: 2, y: 2, updatedAt: now - TTL_MS - 1 }, // stale
  ]
  const client = fakeClient(rows)
  const seen = []
  const core = makeCore(client, { onOthers: r => seen.push(r) })
  await core.tick(now)
  await core.tick(now + POLL_MS - 1)
  await core.tick(now + POLL_MS)
  assert.equal(client.polls().length, 2)   // at now and at now + POLL_MS
  assert.equal(seen.length, 2)
  assert.deepEqual(seen[0].map(r => r.sessionId), ['a'])
})

test('stop sends one leave, and later ticks and moves are inert', async () => {
  const client = fakeClient([{ sessionId: 'a', name: 'g', spec: null, x: 0, y: 0, updatedAt: 0 }])
  let delivered = 0
  const core = makeCore(client, { onOthers: () => { delivered++ } })
  await core.tick(0)
  assert.equal(delivered, 1)
  await core.stop()
  await core.stop()                        // idempotent
  core.move(5, 5)
  await core.tick(IDLE_MS * 3)
  assert.equal(client.leaves().length, 1)
  assert.equal(client.beats().length, 1)   // only the introduction
  assert.equal(client.polls().length, 1)
  assert.equal(delivered, 1)               // no delivery after stop
})

test('a failing network never throws out of tick or stop', async () => {
  const client = {
    async mutation() { throw new Error('offline') },
    async query() { throw new Error('offline') },
  }
  const core = makeCore(client)
  await core.tick(0)                       // must not reject
  await core.stop()
})

test('freshRows drops self, stale and malformed rows', () => {
  const now = 50_000
  const rows = [
    { sessionId: 'a', x: 1, y: 1, updatedAt: now - TTL_MS },       // exactly at the edge: kept
    { sessionId: 'b', x: 1, y: 1, updatedAt: now - TTL_MS - 1 },   // stale
    { sessionId: 'me', x: 1, y: 1, updatedAt: now },               // self
    { sessionId: 'c', x: 'nope', y: 1, updatedAt: now },           // malformed x
    { sessionId: 'd', x: 1, y: 1 },                                // no updatedAt
    null,
    { x: 1, y: 1, updatedAt: now },                                // no sessionId
    { sessionId: 'e', x: 3, y: 4, updatedAt: now },
  ]
  const out = freshRows(rows, now, TTL_MS, 'me')
  assert.deepEqual(out.map(r => r.sessionId), ['a', 'e'])
  assert.deepEqual(freshRows('not an array', now, TTL_MS, 'me'), [])
})

test('mapKeyFor is deterministic and separates documents', () => {
  const a = mapKeyFor('people:\n  - Maya K\n')
  assert.equal(a, mapKeyFor('people:\n  - Maya K\n'))
  assert.notEqual(a, mapKeyFor('people:\n  - Ada L\n'))
  assert.match(a, /^m[0-9a-z]+$/)
})

test('guestName is short, safe and derived from the session', () => {
  assert.equal(guestName('AB12-cd34-ef56'), 'guest-ab12')
  assert.equal(guestName(''), 'guest-')
  assert.ok(guestName(crypto.randomUUID()).length <= 10)
})

test('isConfiguredUrl gates on a real convex.cloud https origin', () => {
  assert.equal(isConfiguredUrl('https://polite-jellyfish-291.convex.cloud'), true)
  assert.equal(isConfiguredUrl(''), false)
  assert.equal(isConfiguredUrl(null), false)
  assert.equal(isConfiguredUrl('http://polite-jellyfish-291.convex.cloud'), false)
  assert.equal(isConfiguredUrl('https://example.com'), false)
  assert.equal(isConfiguredUrl('https://x.convex.cloud/extra'), false)
})
