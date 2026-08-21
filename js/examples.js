// ════════════════════════════════════════════════════════════
//  examples.js: two bundled documents. Every name is fictional.
//  A: a nested team chart (auto-layout in both modes, profiles for people
//     and groups, a shared QA band, one developer split 50/50).
//  B: a building with explicit layout, a spanning title band, partitioned
//     rooms, two on-call bands, owns plaques, doors and a corridor.
// ════════════════════════════════════════════════════════════

export const EXAMPLES = [
  {
    id: 'atlas',
    name: 'Atlas Program',
    hint: 'Nested team chart, shared QA pool, one person split 50/50',
    yaml: `# Atlas Program: a program map with two delivery teams and a shared QA pool.
title: Atlas Program
mode: diagram
notes: |
  Quarterly team map. One developer is split across the two delivery teams;
  QA is a shared pool that both teams pull from.

  *Rohan shows as R. Desai in the tracker.*

profiles:
  delivery:
    color: "#60a5fa"
    capacity: 6
    notes: "Delivery team: owns a slice of the roadmap end to end."
  shared-pool:
    color: "#fbbf24"
    notes: "Shared across delivery teams. Pull from here, never assign permanently."
  qa-india:
    location: India
    role: QA Engineer

people:
  - { name: Noor Haddad, location: USA (Austin), role: Product }
  - { name: Tomas Ibarra, location: Mexico, role: Scrum Master }
  - { name: Priya Raman, location: India, role: Developer, tags: [security, backend] }
  - { name: Mateo Salas, location: Colombia, role: Developer }
  - { name: Leon Varga, location: Hungary, role: Developer, notes: "Splits the week between Kestrel and Lantern." }
  - { name: Aiko Tanaka, location: Japan, role: Back End }
  - { name: Sofia Reyes, location: Argentina, role: Back End }
  - { name: Kwame Mensah, location: Ghana, role: Back End, tags: [sre] }
  - { name: Elena Petrova, location: Bulgaria, role: Front End, tags: [react, accessibility] }
  - { name: Dario Bianchi, location: Italy, role: Solutions Engineer }
  - { name: Hana Kim, location: South Korea, role: Solutions Engineer }
  - { name: Rafael Nunes, location: Brazil, role: Solutions Engineer }
  - { name: Greta Lindqvist, location: Sweden, role: Solutions Engineer }
  - { name: Yusuf Demir, location: Turkiye, role: QA Lead }
  - { name: Anjali Mehta, extends: qa-india }
  - { name: Rohan Desai, extends: qa-india }
  - { name: Chen Wei, location: Singapore, role: QA Engineer }
  - { name: Nadia Sidorova, location: Canada (BC), role: QA Engineer }
  - { name: Omar Farouk, location: Egypt, role: QA Engineer }

groups:
  - name: Product and Delivery
    color: "#a78bfa"
    members: [noor-haddad, tomas-ibarra]
  - name: Team Kestrel
    extends: delivery
    owns: [Checkout, Payments]
    members:
      - priya-raman
      - mateo-salas
      - { person: leon-varga, pct: 50 }
  - name: Team Lantern
    extends: delivery
    color: "#2dd4bf"
    owns: [Catalog, Search]
    needs: [security, sre]
    members:
      - { person: leon-varga, pct: 50 }
    groups:
      - name: Back End
        members: [aiko-tanaka, sofia-reyes, kwame-mensah]
      - name: Front End
        members: [elena-petrova]
  - name: Solutions Eng
    color: "#fb7185"
    members: [dario-bianchi, hana-kim, rafael-nunes, greta-lindqvist]

bands:
  - name: QA
    extends: shared-pool
    spans: [team-kestrel, team-lantern]
    members: [yusuf-demir, anjali-mehta, rohan-desai, chen-wei, nadia-sidorova, omar-farouk]

links:
  - { from: team-kestrel, to: team-lantern, label: shared backlog }
`,
  },
  {
    id: 'revenue',
    name: 'Revenue Platform',
    hint: 'Building with explicit layout, on-call bands, plaques, doors and a corridor',
    yaml: `# Revenue Platform: an office map. Rooms carry an explicit layout in grid cells.
title: Revenue Platform
mode: building
notes: |
  Three squads under one platform, two on-call rotations shared across room
  walls, and two enablement teams downstairs. Switch to **Diagram** to read the
  same document as a team chart.

profiles:
  squad:
    capacity: 4
    notes: "Squad: a room with its own backlog and on-call share."
  oncall:
    color: "#fb923c"
    notes: "Rotation pulled from the adjacent rooms. Shares are weekly averages."

people:
  - { name: Ezra Nakamura, location: USA (Seattle) }
  - { name: Marcus Bell, location: USA (Denver) }
  - { name: Jules Okafor, location: Nigeria, notes: "Half on Core, half on Migration until the cutover." }
  - { name: Amara Diallo, location: Senegal }
  - { name: Caleb Stone, location: Ireland }
  - { name: Riya Kapoor, location: India }
  - { name: Mateus Ferreira, location: Brazil }
  - { name: Lena Fischer, location: Germany }
  - { name: Ines Moreau, location: France }
  - { name: Bakari Otieno, location: Kenya }

groups:
  - name: Revenue Platform
    color: "#2dd4bf"
    groups:
      - name: Next Gen
        extends: squad
        color: "#f472b6"
        owns: [Billing Core, Entitlements]
        layout: { x: 0, y: 1, w: 8, h: 6 }
        groups:
          - name: Core
            members: [{ person: ezra-nakamura, pct: 80 }, { person: jules-okafor, pct: 50 }]
          - name: Migration
            members: [marcus-bell, { person: jules-okafor, pct: 50 }]
      - name: Partner Payouts
        extends: squad
        color: "#60a5fa"
        owns: [Payout Ledger]
        layout: { x: 8, y: 1, w: 8, h: 6 }
        groups:
          - name: Intake
            members: [{ person: amara-diallo, pct: 80 }]
          - name: Ledger
            members: [{ person: caleb-stone, pct: 80 }, riya-kapoor]
      - name: Royalties
        extends: squad
        color: "#a78bfa"
        owns: [Royalty Runs]
        layout: { x: 16, y: 1, w: 8, h: 6 }
        members: [{ person: mateus-ferreira, pct: 80 }, lena-fischer]
  - name: Platform Enablement
    color: "#fbbf24"
    owns: [Build Tooling]
    layout: { x: 0, y: 11, w: 11, h: 4 }
    members: [ines-moreau]
  - name: Data and Reporting
    color: "#34d399"
    owns: [Warehouse, Dashboards]
    layout: { x: 12, y: 11, w: 10, h: 4 }
    members: [bakari-otieno]
  - name: Contracts and Availability
    color: "#94a3b8"
    layout: { x: 22, y: 11, w: 2, h: 4 }

bands:
  - name: On-call West
    extends: oncall
    spans: [next-gen, intake]
    layout: { x: 0, y: 7, w: 12, h: 3 }
    members: [{ person: ezra-nakamura, pct: 20 }, { person: amara-diallo, pct: 20 }]
  - name: On-call East
    extends: oncall
    spans: [ledger, royalties]
    layout: { x: 12, y: 7, w: 12, h: 3 }
    members: [{ person: caleb-stone, pct: 20 }, { person: mateus-ferreira, pct: 20 }, { person: riya-kapoor, pct: 30 }]
  - name: Shared Efforts
    color: "#38bdf8"
    spans: [next-gen, partner-payouts, royalties]
    layout: { x: 0, y: 10, w: 24, h: 1 }

links:
  - { from: next-gen, to: partner-payouts }
  - { from: partner-payouts, to: royalties }
  - { from: platform-enablement, to: data-and-reporting, label: data handoff }
`,
  },
]

export function exampleById(id) { return EXAMPLES.find(e => e.id === id) || null }
