# CLAUDE.md: Floorplan

Team and group map builder: drag people into groups, sub-groups and shared bands,
split someone across teams with percentages, read the result as a nested-box
diagram or as a pixel office, and keep the whole document as YAML with
gitlabform-style `profiles:` + `extends:`. For an engineering manager planning
or explaining a reorg.

**Live:** floorplan.neorgon.com · **Port:** 8868

## Run

```bash
make serve
```

Then open http://localhost:8868. ES modules: it must be served over HTTP, `file://` blocks them.
The only dependency is js-yaml 4.1.0 from cdnjs (pinned, SRI) loaded as a global before `js/app.js`.

## Architecture

One model (`state.js`), two renderers over it, one DnD contract between them.

| Module | Owns |
|---|---|
| `js/schema.js` | `normalizeDoc(raw)` (YAML/JSON tree to model, ids, `profiles`/`extends` merge, error list) and `modelToDoc(model)` (model back to the tree, `extends` kept as a diff against the profile) |
| `js/yaml.js` | `parseYaml` / `emitYaml` over `window.jsyaml`, with the `structuredClone` that breaks alias identity |
| `js/state.js` | `state` (meta, profiles, people, groups, links), `ui` (never persisted), mutations, localStorage `floorplan-v1`, undo/redo 40 deep |
| `js/layout.js` | `computeLayout()`: rects in grid cells for rooms, sub-rooms, bands, title bands; doors vs corridors; straddle seats; overlaps; `passableGrid()` for Visit |
| `js/allocation.js` | per-person totals, group FTE/capacity, `computeInsights()` |
| `js/render.js` | shell: roster, toolbar state, board dispatch, YAML panel, insights drawer, detail sheet, `afterChange()` |
| `js/render-diagram.js`, `js/render-building.js`, `js/parts.js` | the two views and the seat/head markup they share |
| `js/dnd.js` | pointer drag for people and rooms, `commitDrop()` shared with the keyboard carry |
| `js/events.js` | delegated clicks (`data-action`), keys, YAML apply, menus, inline pct editor |
| `js/export.js`, `js/image-export.js` | YAML/JSON/Markdown/Mermaid, `#d=` and `?src=`, imports; SVG/PNG from the measured DOM |
| `js/markdown.js` | escape-first renderer, outline import (`## Group`, `- Name (50%) @Loc`) and export |
| `js/avatar.js` | seeded 12x12 pixel avatars, lazy Silkscreen font |
| `js/visit.js` | walk the office (lazy-imported) |
| `js/examples.js`, `examples/*.yaml` | the two bundled documents (same text, the files exist for `?src=` and llms.txt) |

Vendored from `packages/neorgon-ui/`, never edit in place: `js/neorgon-header.js`, `js/neorgon-footer.js`, `js/neorgon-dom.js`, `css/neorgon-*.css`.

## Data

- localStorage key `floorplan-v1` holds `{ v, doc, savedAt }` where `doc` is the **YAML tree** (what `modelToDoc` emits), not the internal map shape. `loadSaved()` runs it through `normalizeDoc`, so there is one validator in front of every entry point (saved session, `#d=`, `?src=`, file, paste).
- `ui` (selection, picked person, panel state, zoom, visit) is never saved and never in an undo snapshot.
- Undo snapshots are the model JSON; `resetTo()` never clears the stack, so Clear and example loads are undoable.

## Conventions

- Zero build step, plain ES modules, no file over 500 lines (largest: `schema.js`).
- Every mutation is `snapshot()` then mutate then `afterChange()` (save + render + YAML regen).
- Both renderers emit the DnD contract: `data-drag="person" data-person data-from` on draggables, `data-seat="GROUP:PERSON"`, `data-drop="group" data-group` (or `data-drop="roster"`), `data-room-handle="move|resize"`, and `data-pct-bar="GROUP:PERSON"` on the share bar (pointer drag in `dnd.js`, arrow keys in `events.js`, the number badge `data-pct` opens a typed input). `dnd.js` knows nothing else.
- Seats are one size per view: diagram seats fill an equal-column grid (`minmax(172px, 1fr)`), building seats are 1.55 x 1.6 cells (`SEAT_W/SEAT_H` in `layout.js` size rooms for them). Change one and the other.
- URL flags live on `ui`: `embed` (chrome hidden, `saveState()` is a no-op), `readonly` (dnd, pct and mutating actions refuse; `VIEW_ACTIONS` in `events.js` is the allow-list), `fit` (building scale follows the board width), `?mode=` overrides the document for the session.
- Elements tagged `data-svg="box|text|img|disc|badge|tag|door|bar"` are what `image-export.js` traces; a new visual element that should appear in SVG/PNG needs a role.
- Markdown is rendered escape-first (no DOMPurify in the fleet): the regexes only promote already-escaped text.

## Gotchas

- **Members written as bare lowercase ids must exist.** An unknown `maya-k` is an error; an unknown `Maya K` (looks like a name) is created with a warning. The heuristic is the regex in `schema.js` pass 2.
- **`extends` survives visual edits only as a diff.** If a visual edit removes a member the profile provided, `modelToDoc` drops `extends` on that group and writes it in full; the YAML panel status says which group was flattened. Profiles cannot hold nested `groups` (error).
- **The YAML panel regenerates only when the model revision changes** (`rev` in `render.js`) and the textarea is not mid-edit. After a successful Apply or import the visitor's own text is kept (comments included) until the next board change; `markYamlInSync()` is the hook. A failed Apply keeps their text and shows the errors under it.
- **Capacity counts distinct people in the group and its sub-groups** (`groupStats().deep`), not own members; vacant desks are `capacity - deep`, capped at 4 plus a "+N open" chip.
- **Building rooms are absolutely positioned siblings, not nested DOM.** Sub-rooms are separate elements with `z-index = 1 + depth`, so `elementFromPoint()` picks the deepest room and bands can span sub-rooms. Doors sit at z 20, straddle seats at 25: when a straddle occupies a shared wall the door moves to the far end of that wall (`layout.js`).
- **The packer runs bands after rooms, then shifts auto rooms a band landed on, up to 3 passes.** Explicit `layout` rects are never moved; overlaps are allowed and flagged by Insights. Room move/resize (grip/corner) writes an explicit layout; "Auto layout" clears them all.
- **`.workspace` has a fixed height** (`100dvh - 106px`) so the roster and board scroll internally; with `flex: 1` instead, the column flex `main` let it grow to content and the app-mode header auto-hid on the resulting page scroll.
- **Visit mode blurs the active element on start.** Keys typed while a field has focus go to the field; WASD in the YAML textarea is text, not movement.
- **`#d=` on an open tab is a hashchange, not a load**; `app.js` listens for it. `?src=` allows `https://` and `http://localhost` only.
- The pixel font (Silkscreen) loads lazily on the first building render and is not embedded in SVG/PNG exports (system fallback, said in the toast).

## Do not touch

- `js/neorgon-*.js` and `css/neorgon-*.css`: vendored kits, regenerated by `packages/neorgon-ui/sync-*.sh`.
