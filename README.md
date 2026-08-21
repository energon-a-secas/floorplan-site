<div align="center">

# Floorplan

Drag people into teams, rooms, and shared spaces

[![Live][badge-site]][url-site]
[![HTML5][badge-html]][url-html]
[![CSS3][badge-css]][url-css]
[![JavaScript][badge-js]][url-js]
[![Claude Code][badge-claude]][url-claude]
[![License][badge-license]](LICENSE)

[badge-site]:    https://img.shields.io/badge/live_site-0063e5?style=for-the-badge&logo=googlechrome&logoColor=white
[badge-html]:    https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white
[badge-css]:     https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white
[badge-js]:      https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black
[badge-claude]:  https://img.shields.io/badge/Claude_Code-CC785C?style=for-the-badge&logo=anthropic&logoColor=white
[badge-license]: https://img.shields.io/badge/license-MIT-404040?style=for-the-badge

[url-site]:   https://floorplan.neorgon.com/
[url-html]:   #
[url-css]:    #
[url-js]:     #
[url-claude]: https://claude.ai/code

</div>

---

## Overview

Floorplan builds team maps. Drag people from a roster into groups and sub-groups, split someone across two teams with a percentage, add shared spaces that span several groups (a QA pool, an on-call rotation), and read the result two ways: as a nested-box **diagram**, or as a pixel-art **building** with rooms, doors, corridors and desks you can walk past. The whole document is YAML you can edit in a side panel, with gitlabform-style `profiles:` you define once and `extends:` from any group or person.

**Live:** floorplan.neorgon.com

---

## Features

- **Drag and drop** -- roster to group seats at 100%, group to group moves, Alt-drop splits the time evenly, drop on the roster unassigns. Keyboard carry (Enter to pick up, Enter on a group to seat) for the same moves
- **Percentages that add up** -- click any `NN%` badge to edit it; the roster shows each person's total and the Insights drawer flags anyone over or under 100%
- **Groups, sub-groups, shared spaces** -- bands span the groups they name; `capacity` draws vacant desks for open headcount; `owns` renders as plaques
- **Diagram view** -- nested boxes, columns per group, bands as strips across the columns they cover
- **Building view** -- rooms on a 24-column grid, auto-packed or placed with `layout: {x, y, w, h}`; doors where linked rooms touch, corridors where they do not; a person split across two touching rooms sits on the shared wall; drag rooms by the grip, resize from the corner
- **Visit mode** -- walk a pixel avatar through the building with WASD or the arrows; walls block, doors let you through, standing next to a desk shows that person's card
- **YAML with reuse** -- `profiles:` + `extends:` deep-merge (scalars override, members and owns concatenate); anchors and `<<:` merges work too; visual edits regenerate the YAML without flattening `extends`
- **Markdown** -- notes on people, groups and the document; paste a markdown outline (`## Group`, `- Name (50%) @Location`) to import; the Markdown export writes the same syntax back
- **Exports** -- YAML, JSON, Markdown, Mermaid, SVG, PNG (2x), and a `#d=` share link that carries the document; `?src=<url>` loads a hosted file
- **Two examples** -- a nested team chart and an office building with explicit layout, bands and links; every name is fictional
- **Local only** -- localStorage, no account, no server; 40 steps of undo that survive Clear and example loads

---

## YAML in thirty seconds

```yaml
title: Atlas Program
profiles:
  delivery: { color: "#60a5fa", capacity: 6 }
people:
  - { name: Leon Varga, location: Hungary }
groups:
  - name: Team Kestrel
    extends: delivery
    owns: [Checkout, Payments]
    members: [priya-raman, { person: leon-varga, pct: 50 }]
    groups:
      - { name: Back End, members: [aiko-tanaka] }
bands:
  - { name: QA, spans: [team-kestrel, team-lantern], members: [yusuf-demir] }
links:
  - { from: team-kestrel, to: team-lantern, label: shared backlog }
```

The full schema, the link contract and the import formats are in [`llms.txt`](llms.txt). The two bundled documents live in [`examples/`](examples/).

---

## Running locally

ES modules require an HTTP server (not `file://`):

```bash
make serve
```

Or manually:

```bash
python3 -m http.server 8868
```

The only dependency is js-yaml 4.1.0 from a CDN, pinned with SRI; everything else is plain ES modules.

---

## Architecture

![Architecture](docs/architecture.svg)

```
floorplan-site/
├── index.html              # HTML shell: header kit, roster, board, YAML panel, drawers, dialogs
├── llms.txt                # schema + link contract for agents
├── examples/               # the two bundled documents as files (?src= and llms.txt point here)
├── css/
│   ├── style.css           # app shell, roster, seats, panels, sheets, drawer
│   ├── diagram.css         # nested-box view
│   └── building.css        # pixel office: rooms, walls, doors, corridors, desks, visitor
├── js/
│   ├── app.js              # entry point: URL, saved session or example, then render
│   ├── state.js            # model, mutations, localStorage, undo/redo
│   ├── schema.js           # normalize YAML/JSON -> model, profiles/extends, emit tree
│   ├── yaml.js             # js-yaml in/out with the alias-identity clone
│   ├── allocation.js       # totals, FTE, capacity, insights
│   ├── layout.js           # building packer: rects, bands, doors, corridors, straddles
│   ├── render.js           # shell renderer + YAML panel + insights + detail sheet
│   ├── render-diagram.js   # diagram view
│   ├── render-building.js  # building view
│   ├── parts.js            # seat/head markup shared by both views
│   ├── avatar.js           # seeded 12x12 pixel avatars, lazy pixel font
│   ├── dnd.js              # pointer drag for people and rooms, keyboard carry
│   ├── events.js           # delegated clicks, keys, YAML apply, menus
│   ├── export.js           # YAML/JSON/Markdown/Mermaid, share link, imports
│   ├── image-export.js     # SVG + PNG from the measured DOM
│   ├── markdown.js         # escape-first renderer, outline import/export
│   ├── visit.js            # walk the office (lazy-loaded)
│   └── examples.js         # Example A and B
├── docs/architecture.mmd   # source of the diagram above
├── robots.txt, sitemap.xml, CNAME, Makefile
└── README.md
```

---

<div align="center">
<sub>Part of <a href="https://neorgon.com/">Neorgon</a></sub>
</div>
