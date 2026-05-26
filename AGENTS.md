# Skyshift Agent Notes

- `AGENTS.md` is the main source for repo coding style and architecture guidance.
- **Scope discipline.** Coding style, vocabulary, architecture, and file conventions only. Operational/git rules live outside this public-facing file. Deployment, release, performance budgets, and other non-style content go elsewhere — `review-structure` and `deep-simplify` subagents load this file in full, so keep it focused.
- Project-local Claude-style skills live in `.claude/skills/`.
- When a referenced Claude skill is used, read the corresponding `SKILL.md` and follow it directly instead of rewriting the workflow from memory.
- Prefer the current stable entrypoints mentioned by those skills:
  - Economy report: `./dev/economy/report.sh`
  - Economy solver: `./dev/economy/balance-solver.sh`
  - Image generators: `node dev/images/<script>.mjs`
  - Strings atlas: `node --import tsx dev/strings/generate.ts` — regenerates `strings.html`, the print-friendly reference of every game string from the data files.
  - Audio pipeline: `./dev/audio/audio-build-all.sh` (extract strings, generate TTS, apply effects); siblings follow `audio-<role>-<subject>` (`build`/`sample`/`test`/`verify`).
  - Performance / GC checks (Puppeteer-driven; need `npm run dev` running):
    - `node dev/performance/heap-leak-check.mjs` — heap snapshots over time, for memory-leak hunts.
    - `node dev/performance/scene-switch-check.mjs` — navigate between URLs to cycle Game-scene construct/destroy; checks teardown leaks.
    - `node dev/performance/frame-jank-check.mjs` — CDP trace of GC + frame timing, for per-frame allocation pressure.
  - Static-page load checks (Puppeteer-driven; need `npm run dev` running):
    - `node dev/static-tests/run-all.mjs` — loads `/`, `/help.html`, `/lore.html`, `/design.html`, `/tools.html` and clicks basic interactions, asserting no console errors. Run after edits to those pages, their page/entry scripts (`src/static-pages/*`, `src/editor/index.ts`), or shared data shapes (nations/wares/stations) those pages read.

## Validation

- `npm run typecheck` / `npm run lint` — run after any `.ts` edit (`lint:fix` to auto-fix + prettier).
- `npm test` — run when touching simulation code (economy, stations, trade).
- `npm run build` — production Vite build. Run when changes span many modules or touch HTML/CSS/entry files.
- `npm run dev` — manual browser testing. Doesn't exit on its own; only run in the background when verifying UI.

## Code Style

- Entity type naming — two kinds of `data/` type, distinguished by how the runtime relates to it:
  - **Per-type catalog**: one template shared by many runtime instances, which select it via a `*TypeId` union. Name it `XTypeTemplate`. Examples: `StationTypeTemplate` (`StationTypeId`) + runtime `Station`; `ShipTypeTemplate` (`ShipTypeId`) + runtime `Ship`.
  - **Canonical/definitional**: one template ↔ one runtime thing, no `*TypeId`. Keep `XTemplate` + bare runtime name. Examples: `WareTemplate`; `NationTemplate` + `Nation`; `SectorTemplate` + `Sector`; `MapTemplate` + `GameMap`; `StationZoneTemplate` + `StationZone`.
  A runtime-composed per-instance record is **not** a template and never takes a `*Template` name — e.g. `PlacedStation` is built from a `PresetStation` (and by `placeBuild` / emigration / the editor) into the flat runtime `Station`. When the runtime adds fields, compose with intersection (`Template & { extras }` or `Omit<Template, K> & { extras }`), not by nesting the template inside a wrapper object. Template and runtime types live on opposite sides of the `data/` ⇄ `src/` boundary; a file declaring both is a signal it straddles the boundary — split into the `data/<entity>-types.ts` + `src/sim-<entity>-types.ts` pair.
- Pre-release game: no backward compat, no forward compat without explicit user approval, users don't edit saves. In "preserve current pattern" vs "forward-looking change" trade-offs (`.claude/skills/review-structure/structure.md` § Forward-looking refactor decisions), favor the forward-looking option — patterns that land now become the template future contributors copy.

## Project Vocabulary

The universal style rules live in the project-local coding-style reference (`.claude/skills/review-structure/structure.md` + `.claude/skills/review-structure/structure-comments.md`). This section carries the project-specific verb reservations, rejected jargon, preferred patterns, and framework specifics that those rules reference but don't define.

### Reserved verbs

- **`build`** — reserved for station-construction-action vocabulary (e.g. `placeBuild`, `Station.build`, `BuildPlacement`). Don't reuse `build*` for non-construction operations (data hydration, save loading) where it would compete with the construction meaning. Carve-out: `build*` is fine for data-transformation / UI / test helpers far from station vocabulary (`buildRouteStatsFromWareTotals`, `buildFakeScene`) per Example 9 of the coding-style reference.
- **`tick`** — reserved for per-tick handlers (one call per sim tick during the active period).
- **`advance`** — reserved for clock or queue advancement (one call moves an accumulator forward by an amount). Don't conflate with `tick`.
- **`setup`** — reserved for one-time wiring of DOM/scene controls and event handlers. Don't default to `init*`/`create*` for wire-up.
- **`destroy`** — reserved for lifecycle teardown, paired with `create*VisualBundle`. Don't use `dispose`/`cleanup`/`teardown`.

### Rejected vocabulary

Use the named alternative; don't introduce these into new code, and rename when surfacing during review:

- `inflate` (for template → runtime conversion) → `create from` per Preferred patterns. Plain-English "inflate" (test assertions about values growing) stays.
- `world` → `map` for project coord/space vocabulary. Phaser API comments and lore uses ("world events", "extraction world") stay.
- `*Definition` / `*Data` (as type-name suffixes for `data/` shapes) → `XTypeTemplate` (per-type catalog) or `XTemplate` (canonical/definitional shape) in `data/`, + bare name (runtime instance types in `src/`).
- `authored` / `authoring` / `pre-authored` (as a descriptor for data) → name the actual contrast instead. Use `template` for type shapes, `the data files` / `from data files` for references to data values, `predefined` for fixed names vs. dynamic draws, `the initial state` / `the map template` for seed contexts, `hand-tuned` / `hand-written` for designer-set values. Carve-out: `edit` / `editing surface` for the in-browser editor's UI vocabulary stays.
- `mint` (for id generation) → `generate`. A user-driven repo-wide sweep renamed `mintCounterId` → `generateCounterId` and its siblings because `mint` was rejected as distant-domain jargon outside this project's vocabulary. `generate*` is the established verb for unique-id minters (`generateCounterId`, `generateUniqueId`, `generateUniqueShipCode`, `generateUniqueZoneCode`). Carve-out: plain-English "mint" outside id generation (e.g. a test assertion about a minted value) stays.

### Preferred patterns

- **Data-hydration helpers** — `createXFromY(template, ...)` returns a runtime instance built from the template. JSDoc names what's created and what it's from (e.g. "Create a full runtime `Station` from a `PlacedStation`."). Examples: `createZoneFromTemplate`, `createStation`, `createMapFromTemplate`, `createStationUnderConstruction`.
- **Save deserialization codecs** — `xFromSnapshot(snapshot, ctx?)` (no `create` prefix). Often takes a `SnapshotContext` for ref re-binding. Examples: `shipFromSnapshot`, `stationFromSnapshot`, `tradeShipFromSnapshot`, `emigrationEventFromSnapshot`. Different shape from data-hydration on purpose: deserialization rebinds saved-state refs; data-hydration produces fresh runtime instances from templates.
- **Discriminator field on exported event/transfer/reservation shapes** — domain-specific field name, not bare `type`. Examples: `TradeReservation.cargoDirection`, `TradeTransferEvent.cargoDirection` (values `"incoming" | "outgoing"`). Bare `type` is fine for tagged-union variants where the values themselves are unambiguous (`ShipAction.type` with `"fly" | "wait" | "cargo-withdrawal" | "cargo-deposit" | "decommission"`).
- **Closed-set discriminator fields with values-as-meaning** — name the field after the values (e.g. `surfaceOrOrbit`) when the values _are_ the meaning, not categories of an underlying domain. See Example 13 of the coding-style reference.
- **Boundary validation** — single canonical entry-point check; example: `validateSnapshot` rejects loads where `version !== SAVE_VERSION` or the shape is malformed. Untrusted data (user input, external APIs) always validates at the boundary. For internal invariants, validate at the one place that can break the rule (e.g. a string-keyed registry lookup) rather than layering guards through every consumer (per cluster D.2 of the coding-style reference).
- **`*Label` suffix reserved for "user-facing variant of an internal field"** — when an object has a single `name` (or other field) that's used both internally and shown to the user, keep it bare. Only introduce a paired `*Label` when there's a separate internal-only value the user doesn't see — e.g. an internal `code` field plus a separate user-facing `codeLabel` field. Don't rename a dual-use field to `displayName`/`displayLabel` just because consumer-site reads chain through nested objects (`station.name` next to `station.stationType.name` is fine — both are honest names of distinct things).

### Framework lifecycle exemption

Per cluster B.5 of the coding-style reference, framework-prescribed lifecycles are exempt from the "no init-then-do" rule. In this project that means Phaser scene `init` / `preload` / `create` / `update` plus DOM event registration. We don't get to reshape contracts the framework dictates.

## CSS & UI

- Reuse `ui.css` tokens and component classes (`var(--active)`, `var(--paper)`, `.hud-btn`, `.speed-hud`, `.id-card`, `.cargo-grid`, etc.) rather than rolling bespoke styles — colors, typography, spacing, borders, buttons, panels, all of it. If the needed token or component doesn't exist, extend the system: add it to `ui.css`, showcase it in `design.html`, then use it. Don't hardcode one-off styles to work around a missing token.
- `design.html` is the UI design reference. When you change in-game UI (markup in `universe.html`/`tools.html`, tokens or components in `ui.css`), mirror the change in `design.html` so the showcase stays in sync — and vice versa, designs landed in `design.html` should be propagated to the game. The UI transition is still in progress; if the live game doesn't match `design.html`, assume that area hasn't been transitioned yet and ignore the mismatch.
- Vendor prefix order: prefixed first, standard last (e.g. `-webkit-backdrop-filter` before `backdrop-filter`). LightningCSS, which Vite 8 uses for CSS minification, dedupes adjacent declarations with the same value and keeps only the last one — putting the standard property last ensures it survives minification.
- Don't rely on inline `<style>` winning over `<link rel="stylesheet">` through source order. Vite's production build moves processed stylesheet links to after inline `<style>` tags, inverting the cascade. Either give inline overrides higher specificity than the `ui.css` rule they need to beat, or don't put defaults in `ui.css` that most pages have to override.
## Game Architecture

### Entity hierarchy

- **Nation** — top-level political entity. Owns stations and ships. Lore and station/ship name pools in `data/strings-nations.ts`.
- **Station** — belongs to a nation. Has a type and size (S/M/L). Produces and consumes wares via inventory slots. Lore in `data/strings-stations.ts`; initial placements per preset in `data/map-preset-*.ts` (reference map zones by id).
- **Ship** — belongs to a station (and by extension its nation). Has cargo capacity, speed, allowed wares, and hull geometry. Lore in `data/strings-ships.ts`. Runtime ships orbit their home station and execute trade flights.
- **Ware** — goods produced, consumed, and transported. Structured as a tiered production chain (raw → refined → final → sinks).
- **Sector** — a region of the map; stations live in zones inside sectors. Lore in `data/strings-sectors.ts`.
- **StationZone** — named footprint slot inside a sector; stations are placed into zones via the preset map.

### Ship rendering orientation

- Ships face right (positive X). Front/nose points right, back/stern points left.
- Hull is two squares wide by one tall. Each half is a trapezoid sharing a vertical center seam.
- `taperFront`/`taperBack` control how narrow the nose/stern get (1=full width, 0=sharp point).
- `taperFrontCurve`/`taperBackCurve` add Bezier bulge to the side edges (left and right, not top/bottom). Positive = convex outward (pod), negative = concave inward.

### Separation of concerns

- Simulation (economy, trade, production) must have zero Phaser dependency. The game should run headless.
- `src/phaser/` — everything that imports the `phaser` runtime (map rendering, cameras, HUD controls, input). Simulation code must never import from here.
- `render-*` modules (e.g. `src/render-hud-icon.ts`, `src/render-morse-bar.ts`) — non-phaser rendering helpers (Canvas2D silhouettes, SVG icons, label formatting). Consumed from both `src/phaser/` and `ui-*` modules. Must not import `phaser`. ESLint blocks sim files from importing `render-*`.
- `ui-*` modules (e.g. `src/ui-settings-panel.ts`, `src/ui-savegame-manager.ts`) — DOM panels and HUD chrome outside the Phaser canvas (event log, settings panel, nations pane, save-slot UI, etc.). May touch `document`/DOM APIs; must not import `phaser`. ESLint blocks sim files from importing `ui-*`.
- `audio-*` modules (e.g. `src/audio-announcer.ts`) — Web Audio runtime, voice-key vocabulary, speech-string collection. Use `AudioContext`/`fetch`/Vite asset globbing. ESLint blocks sim files from importing `audio-*`.
- `storage-*` modules (e.g. `src/storage-save-slots.ts`, `src/storage-preferences.ts`) — localStorage-backed persistence. `storage-save-slots.ts` is the sim-safe persistence entrypoint (the localStorage carve-out).
- `src/editor/` — the in-browser map/economy editor. Explicitly allowed to span phaser + DOM + sim.
- `src/static-pages/` — DOM + Canvas/Phaser code for landing/help/lore/design pages. May span phaser + DOM; sim must not import.
- `src/tests/` — the only home for `*.test.ts` files. Reuse shared helpers in `src/tests/test-utils.ts` and `src/tests/factories.ts` instead of re-rolling test scaffolding.
- Simulation files use the `sim-*.ts` prefix (e.g., `sim-trade-manager.ts`, `sim-station.ts`). ESLint enforces no `phaser` imports, no DOM globals, and no cross-cluster imports from sim — per-group error messages in `eslint.config.mts` spell out which boundaries fire.
- Simulation models should not store render-only state (angles, sprites, selection). Simulation owns action-phase state — phase name, start time, duration, progress, logical positions — which is deterministic and serializable. Render owns exact angles, speeds, curves, and trail geometry, computed from sim state + wall clock each frame.
- Flight/travel endpoints are identified by logical location (station + surfaceOrOrbit), not by map coordinates. Map coords come from render.
- Entity state lives on the entity itself. Managers coordinate lifecycle; they must not duplicate state in parallel `Map<entityId, state>` structures. Read and write entity fields directly.

### Where data lives

- `data/` holds game data and data-owned constants. Put canonical entity definitions, map layout, economy numbers, and shared content values here.
- `src/` holds game engine and runtime code. Put helper functions and systems that operate on game data here, even when they are map-related.
- Keep `data/ships.ts` limited to ship type definitions and static ship data. Ship lookup helpers, runtime config, and behavior belong in `src/`.
- Apply the same rule to the rest of `data/`: mutable runtime state, per-entity caches, random assignment, lookup helpers, and HTML formatting belong in `src/`. Static tuning constants stay in `data/visuals-*` / `data/controls-*` per the file naming conventions below.
- File naming conventions:
  - `data/visuals-*.ts` — visual-only tuning (colors, sizes, animation timings). Test: removing a value only changes how things _look_, not how the simulation behaves. Entity-scoped visual tuning stays entity-first (`data/ship-visuals.ts`, `data/station-visuals.ts`). Camera behavior tuning (zoom, drag friction, culling refresh) lives in `data/controls-camera.ts`, not here.
  - `data/controls-*.ts` — behavior/control tuning that isn't purely visual (e.g. `data/controls-camera.ts` zoom + drag friction + culling refresh; `data/controls-game-speed.ts` speed cycle).
  - `data/strings-{name}.ts` — extracted prose (lore, name pools, error text). Imported as `import * as X from "../data/strings-{name}"`; entries use `UPPER_CASE` keys (e.g., `sectorLore.UNDERLEAF`, `saveError.SLOT_EMPTY`). Reach for the split when embedded prose stops two consecutive structural entries from being visible together; the strings file holds named exports (not a `Record<string, string>`) so the entity file reads as one row per entry and TypeScript catches misspelled key references.
  - `src/util-{name}.ts` — generic helper files (e.g., `util-ids.ts`).
  - `src/sim-*-template.ts` — entity type-template lookups (e.g., `sim-ship-template.ts` exposes `getShipTypeTemplate`).
  - `src/sim-*-types.ts` — runtime instance type definitions paired with the data-side types in `data/`. Examples: `sim-station-types.ts` (`Station`, `InventorySlot`, ...) pairs with `data/station-types.ts` (`StationTypeTemplate` catalog, `PlacedStation`, ...); `sim-map-types.ts` (`Sector`, `GameMap`) pairs with `data/map-types.ts` (`SectorTemplate`, `MapTemplate`).
  - Overview-mode code splits across `src/phaser/overview-*.ts` (Phaser systems/render) and `src/ui-overview-*.ts` (DOM panes).
  - Parent-first naming for child extractions from a primary file (e.g., `station-render-selection.ts` is a child of `station-render.ts`).
  - `src/sim-trade-*.ts` — trade-system cluster split by concern. `sim-trade-manager.ts` owns the `TradeManager` class (active-ship registry, per-tick update loop, snapshot capture/restore); resolvers, observer registration, and the trade clock are methods on it — consumers thread the instance through. Sibling files split decision logic, queue + cargo mutations + the action-dispatch loop, reservation lifecycle, event log, and route statistics. Shared types and `getTotalCargo` live in `sim-trade-types.ts`; siblings import from there, not from each other or from the manager. The five `sim-ship-action-*.ts` codec siblings (one per `ShipAction.type`, routed by `sim-trade-save-snapshot.ts`) also never import each other; the shared `waitPlaceholder` fallback they decode to lives once in `sim-ship-action-shared.ts` — don't re-inline it or merge the codec siblings back together. Each file's top-of-file header is authoritative for its scope.
- Prefer flat-with-suffix naming over deep subfolder nesting. Alphabetical adjacency clusters related files (e.g., `sim-ship-manager.ts`, `sim-ship-template.ts`, `sim-ships.ts` sort together) and keeps a complete cluster visible in one directory listing. When considering a new folder, ask "what rule does this folder enforce that a prefix wouldn't?" Framework-import boundaries (`src/phaser/`), sub-applications (`src/editor/`), test discovery (`src/tests/`), and binary assets qualify; grouping similar source files alone doesn't. The `audio-*` cluster spans `data/` and `src/` precisely because the prefix keeps both halves visible where a `src/audio/` folder would hide one.
- Entity split: for each of `nation` / `station` / `ship` / `ware`, `data/<entity>-types.ts` holds template shapes and `data/<entity>.ts` holds the catalog.
- Lore lives inline on each template as a `lore` field: `NationTemplate.lore`, `StationTypeTemplate.lore`, `ShipTypeTemplate.lore`, `SectorTemplate.lore`.

## Phaser

- Phaser v4 differs substantially from v3 in both API and architecture. Online v3-era answers often look correct but aren't; prefer local references over web search.
- Render state type naming:
  - Per-entity visual holders → `*VisualBundle` (e.g., `StationVisualBundle`, `ShipVisualBundle`, `ShipTravelVisualBundle`). One per entity instance; holds Phaser game objects + transient render state (last-painted values, dirty flags, throttle counters).
  - Scene-level visual subsystems → named for what they own, no bare `*System` suffix (e.g., `AmbientTraffic`, `SectorGrid`, `TradeRouteOverlay`). One per scene; holds pooled objects + subsystem-wide state. The `createX()`-returns-an-object shape already signals "runtime subsystem"; add a qualifier only when the bare concept noun is ambiguous (e.g. `OverviewMode`, not bare `Overview`).
- `Bundle` is also acceptable as a function-name suffix for helpers that paint 2+ composed visual items (e.g., `drawStationOrbitBundle`).
- Local references, both populated by `dev/fetch-phaser-docs.sh` (gitignored):
  - `dev/phaser-docs.local/` — typedoc-generated API reference HTML from Phaser's `.d.ts` files. Open `index.html` for browsing.
  - `dev/phaser-skills.local/` — AI agent skill folders, one per subsystem (cameras, sprites-and-images, render-textures, filters-and-postfx, game-object-components, scenes, tweens, input-keyboard-mouse-touch, tilemaps, v4-new-features, v3-to-v4-migration, etc.). Each contains a `SKILL.md` with task-oriented guidance, code examples, and API tables. Grep these first when you need subsystem-specific detail.

## Performance

- Cache reusable objects instead of recreating them. `src/render-data-uri-cache.ts` (`getCachedDataUri(key, build)`) caches SVG data URIs under caller-chosen keys; apply the same pattern to any computed result that depends on stable inputs.
- Skip work for off-screen objects. Check viewport bounds before updating visuals (see `isVisibleInViewport` in `src/phaser/viewport-culling.ts`).
- Throttle UI updates by priority: focused elements may refresh every sim tick; background elements refresh at most every Nth tick. See `shouldUpdateUI` in `src/render-dirty-state.ts` and `focusedAttentionIntervalTicks` / `backgroundAttentionIntervalTicks` in `data/economy-config.ts`.
- Avoid per-frame DOM writes. Use the diffing helpers in `src/ui-dom-cache.ts` (`setHtmlIfChanged`, `setTextIfChanged`, `setAttrIfChanged`) instead of writing per-class `last*` diffing fields.
- Pool and reuse game objects (Phaser circles, sprites) via `GameObjectRenderPool` instead of creating and destroying them each frame.
