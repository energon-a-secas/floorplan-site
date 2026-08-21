// ════════════════════════════════════════════════════════════
//  templates.js: starting shapes for groups, so a map begins from the
//  things teams actually are (a squad, a platform team, a pod with front
//  and back end, an on-call rotation) instead of an empty box. Each entry
//  is a small recipe over the state mutations; nothing here is special.
// ════════════════════════════════════════════════════════════

import { state, addGroup, updateGroup, topGroups } from './state.js'

export const TEMPLATES = [
  { id: 'squad', name: 'Squad', hint: '6 seats, owns one area' },
  { id: 'pod', name: 'Pod: Back End + Front End', hint: 'a team with two sub-groups' },
  { id: 'platform', name: 'Platform team', hint: '8 seats, owns tooling and CI' },
  { id: 'leadership', name: 'Leadership', hint: 'product, engineering, design leads' },
  { id: 'oncall', name: 'On-call rotation (shared)', hint: 'a band across every team' },
  { id: 'qa', name: 'QA pool (shared)', hint: 'a band across every team' },
  { id: 'support', name: 'Support desk (shared)', hint: 'a band with a rotation' },
]

/** Create the groups a template describes. Returns the id of the group to select. */
export function applyTemplate(id) {
  const spanAll = () => topGroups().map(g => g.id)
  switch (id) {
    case 'squad': { const g = addGroup({ name: 'New squad' }); updateGroup(g.id, { capacity: 6, owns: ['Area'], notes: 'Squad: owns one slice of the product end to end.' }); return g.id }
    case 'pod': { const g = addGroup({ name: 'New pod' }); updateGroup(g.id, { capacity: 8 }); addGroup({ name: 'Back End', parent: g.id }); addGroup({ name: 'Front End', parent: g.id }); return g.id }
    case 'platform': { const g = addGroup({ name: 'Platform' }); updateGroup(g.id, { capacity: 8, owns: ['Build tooling', 'CI', 'Observability'], needs: ['sre'] }); return g.id }
    case 'leadership': { const g = addGroup({ name: 'Leadership' }); updateGroup(g.id, { capacity: 4, owns: ['Roadmap', 'Hiring'], notes: 'Product, engineering and design leads.' }); return g.id }
    case 'oncall': { const g = addGroup({ name: 'On-call rotation', kind: 'band', spans: spanAll() }); updateGroup(g.id, { notes: 'Weekly rotation pulled from the teams it spans. Shares are averages.' }); return g.id }
    case 'qa': { const g = addGroup({ name: 'QA pool', kind: 'band', spans: spanAll() }); updateGroup(g.id, { notes: 'Shared testers. Pull from here, never assign permanently.' }); return g.id }
    case 'support': { const g = addGroup({ name: 'Support desk', kind: 'band', spans: spanAll() }); updateGroup(g.id, { capacity: 3, needs: ['support'] }); return g.id }
    default: return null
  }
}

export const templateById = id => TEMPLATES.find(t => t.id === id) || null
