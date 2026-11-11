// What the document took from the workspace (state.wsFrom) belongs to that
// document: another document replacing the board clears it, undo brings it back.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { state, resetTo, snapshot, undo, redo, clearAll } from '../js/state.js'
import { normalizeDoc } from '../js/schema.js'

test('wsFrom follows its document through replace, undo and redo', () => {
  const team = normalizeDoc({ people: [{ id: 'maya', name: 'Maya' }], groups: [] }).model
  team.wsFrom = { people: ['maya'], teams: [] }
  resetTo(team)
  assert.deepEqual(state.wsFrom, { people: ['maya'], teams: [] })
  // a version or the puzzle (same document, keepHistory) keeps it
  resetTo(normalizeDoc({ people: [{ id: 'maya', name: 'Maya' }] }).model, { keepHistory: true })
  assert.deepEqual(state.wsFrom, { people: ['maya'], teams: [] })
  // a pasted document replaces the board: it took nothing from the workspace
  snapshot()
  resetTo(normalizeDoc({ people: [{ id: 'maya', name: 'Bob' }] }).model)
  assert.equal(state.wsFrom, null)
  assert.ok(undo())
  assert.deepEqual(state.wsFrom, { people: ['maya'], teams: [] })
  assert.ok(redo())
  assert.equal(state.wsFrom, null)
  assert.ok(undo())
  clearAll()
  assert.equal(state.wsFrom, null)
})
