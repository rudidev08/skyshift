# Skyshift Agent Notes

- `AGENTS.md` is the main source for repo coding style and architecture guidance.
- Project-local Claude-style skills live in `.claude/skills/`.
- When a referenced Claude skill is used, read the corresponding `SKILL.md` and follow it directly instead of rewriting the workflow from memory.
- Prefer the current stable entrypoints mentioned by those skills:
  - Economy report: `./dev/economy/report.sh`
  - Economy solver: `./dev/economy/balance-solver.sh`
  - Image generators: `node dev/images/<script>.mjs`
  - Performance / GC sanity checks (Puppeteer-driven; need `npm run dev` running):
    - `node dev/performance/heap-leak-check.mjs` — heap snapshots over time, for memory-leak hunts.
    - `node dev/performance/scene-switch-check.mjs` — navigate between URLs to cycle Game-scene construct/destroy; checks teardown leaks.
    - `node dev/performance/frame-jank-check.mjs` — CDP trace of GC + frame timing, for per-frame allocation pressure.
  - Static-page smoke tests (Puppeteer-driven; need `npm run dev` running):
    - `node dev/static-tests/run-all.mjs` — loads `/`, `/help.html`, `/lore.html`, `/design.html`, `/tools.html` and clicks basic interactions, asserting no console errors. Run after edits to those pages, their entry scripts under `src/static-pages/`, or shared data shapes (nations/wares/stations) those pages read.

## Validation

- `npm run typecheck` — TypeScript (`tsc --noEmit`), fast, run for any `.ts` edit.
- `npm run lint` — ESLint, run for any `.ts` edit.
- `npm test` — runs all `*.test.ts` files in `src/tests/` via `run-tests.sh`. Run when touching simulation code (economy, stations, trade).
- `npm run build` — production Vite build. Run when changes span many modules or touch HTML/CSS/entry files.
- `npm run dev` is available for manual browser testing; it doesn't exit on its own, so only run it in the background when you need to verify UI.

## Git

- Explicit user approval is required before staging or committing only when either (a) the current branch is `main` or `stable`, or (b) Claude is initiating the commit without the user asking. On any other branch, when the user has asked for a commit, proceed without a confirmation step.
- **Invoking the `/commit` or `/stable` skill counts as that explicit approval**, including for direct-to-main and direct-to-stable commits and for the push that follows. The skill invocation is itself the user's instruction to commit (and, for `/stable`, to push to the stable branch). No additional "confirm direct-to-main" prompt is needed — proceed once the commit message has been shown and accepted per the one-confirmation-step rule below.
- When approval is required: **exactly one confirmation step**, not two. Draft the commit message, show it once, and commit on approval. If the diff mixes unrelated work or something looks unusual, fold that callout into the same approval request so the user can confirm or redirect in a single reply — don't ask a scope/style clarifying question first and then re-ask for approval afterward.

## Code Style

- Entity type naming: `*Template` for authored/init-time shapes (live in `data/`); bare name for runtime instance types (live in `src/`). Examples: `ShipTemplate` + `Ship`, `StationTemplate` + `Station`, `WareTemplate` + `Ware`, `NationTemplate` + `Nation`. When the runtime adds fields, compose with intersection (`Template & { extras }` or `Omit<Template, K> & { extras }`), not by nesting the template inside a wrapper object. (Supersedes earlier `*Definition` / `*Data` guidance — rename is in progress.)
- Pre-release game: no backward compat, no forward compat without explicit user approval, users don't edit saves. In "preserve current pattern" vs "forward-looking change" trade-offs (`coding/structure.md` § Forward-looking refactor decisions), favor the forward-looking option — patterns that land now become the template future contributors copy.

## Project Vocabulary

The universal style rules live at `.claude/coding/structure.md` and `.claude/coding/comments.md`. This section carries the project-specific verb reservations, rejected jargon, preferred patterns, and framework specifics that those rules reference but don't define.

### Reserved verbs

- **`build`** — reserved for station-construction-action vocabulary. Examples: `placeBuild`, `startNextStationBuild`, `startInitialStationBuilds`, `Station.build` (build-state field), `StationGenerationalShipBuild` (generational-ship build type), `BuildPlacement` (placement-parameter type). Don't reuse `build*` for non-construction operations (data hydration, save loading, etc.) where it would compete with the construction meaning. Carve-out: `build*` is fine for data-transformation / UI / test helpers far from station vocabulary (`buildRouteStatsFromWareTotals`, `buildSectorIcon`, `buildFakeScene`, etc.) per Example 9 of the coding-style reference.
- **`tick`** — reserved for per-tick handlers (one call per sim tick during the active period). Examples: `Simulation.tick`, `EmigrationManager.tick`, `tickEconomy`, `tickFlightData`, `tickStationProduction`.
- **`advance`** — reserved for clock or queue advancement (one call moves an accumulator forward by an amount). Examples: `advanceQueue`, `advanceTradeTime`, `EconomyTimer.advance`. Don't conflate with `tick`.

### Rejected vocabulary

Use the named alternative; don't introduce these into new code, and rename when surfacing during review:

- `inflate` (and "inflated" / "inflation") → `create from`. Past convention was "inflate authored X into runtime Y"; current convention is "create runtime Y from authored X".
- `mint` → `generate`. Past convention used `mintXId`; current convention is `generateXId` / `generateXCode`.
- `world` (for project coord/space vocabulary) → `map`. Examples: `getWorldPosition` → `getMapPosition`. Carve-out: Phaser API references (`camera.getWorldPoint`, "world center = scrollX..." Phaser-behavior comments) and game-lore uses ("world events", "extraction world") stay.
- `prebuilt` → `preset`. Type renames already landed: `PrebuiltStation` → `PresetStation`, etc.
- `interPlanet` → `interStation`. The game has no planets; entity hierarchy is stations + station zones.
- `*Definition` / `*Data` type suffixes → `*Template` (authored shapes in `data/`) + bare name (runtime instance types). Already in progress per Code Style above.

### Preferred patterns

- **Data-hydration helpers** — `createXFromY(authored, ...)` returns a runtime instance built from authored data. JSDoc reads "Create runtime X from authored Y." Examples: `createZoneFromDefinition`, `createStation`, `createMapFromTemplate`, `createStationsAndShipsFromMap`, `createStationUnderConstruction`.
- **Save deserialization codecs** — `xFromSnapshot(snapshot, ctx?)` (no `create` prefix). Often takes a `SnapshotContext` for ref re-binding. Examples: `shipFromSnapshot`, `stationFromSnapshot`, `tradeShipFromSnapshot`, `eventFromSnapshot`, `reservationFromSnapshot`. Different shape from data-hydration on purpose: deserialization rebinds saved-state refs; data-hydration produces fresh runtime instances from authored templates.
- **Discriminator field on exported event/transfer/reservation shapes** — domain-specific field name, not bare `type`. Examples: `TradeReservation.cargoDirection`, `TradeTransferEvent.cargoDirection` (values `"incoming" | "outgoing"`). Bare `type` is fine for tagged-union variants where the values themselves are unambiguous (`ShipAction.type` with `"fly" | "wait" | "cargo-withdrawal" | "cargo-deposit" | "decommission"`).
- **Closed-set discriminator fields with values-as-meaning** — name the field after the values (`surfaceOrOrbit`, `incomingOrOutgoing`) when the values *are* the meaning, not categories of an underlying domain. See Example 13 of the coding-style reference.
- **Boundary validation** — single canonical entry-point check; example: `validateSnapshot` rejects loads where `version !== SAVE_VERSION` or the shape is malformed. Internal code is trusted; only validate where untrusted data crosses into the program (per cluster D.2 of the coding-style reference).
- **`*Label` suffix reserved for "user-facing variant of an internal field"** — when an object has a single `name` (or other field) that's used both internally and shown to the user, keep it bare. Only introduce a paired `*Label` when there's a separate internal-only value the user doesn't see — e.g. an internal `code: "BIO-042"` and a separate user-facing `codeLabel: "Bio Cargo Lifter 042"`. Don't rename a dual-use field to `displayName`/`displayLabel` just because consumer-site reads chain through nested objects (`station.name` next to `station.stationType.name` is fine — both are honest names of distinct things).

### Framework lifecycle exemption

Per cluster B.5 of the coding-style reference, framework-prescribed lifecycles are exempt from the "no init-then-do" rule. In this project that means Phaser scene `init` / `preload` / `create` / `update` plus DOM event registration. We don't get to reshape contracts the framework dictates.

## CSS & UI

- Reuse `ui.css` tokens and component classes (`var(--active)`, `var(--paper)`, `.hud-btn`, `.speed-hud`, `.id-card`, `.cargo-grid`, etc.) rather than rolling bespoke styles — colors, typography, spacing, borders, buttons, panels, all of it. If the needed token or component doesn't exist, extend the system: add it to `ui.css`, showcase it in `design.html`, then use it. Don't hardcode one-off styles to work around a missing token.
- `design.html` is the UI design reference. When you change in-game UI (markup in `maps.html`/`tools.html`, tokens or components in `ui.css`), mirror the change in `design.html` so the showcase stays in sync — and vice versa, designs landed in `design.html` should be propagated to the game. The UI transition is still in progress; if the live game doesn't match `design.html`, assume that area hasn't been transitioned yet and ignore the mismatch.
- Vendor prefix order: prefixed first, standard last (e.g. `-webkit-backdrop-filter` before `backdrop-filter`). LightningCSS, which Vite 8 uses for CSS minification, dedupes adjacent declarations with the same value and keeps only the last one — putting the standard property last ensures it survives minification.
- Don't rely on inline `<style>` winning over `<link rel="stylesheet">` through source order. Vite's production build moves processed stylesheet links to after inline `<style>` tags, inverting the cascade. Either give inline overrides higher specificity than the `ui.css` rule they need to beat, or don't put defaults in `ui.css` that most pages have to override.

## Game Architecture

### Entity hierarchy

- **Nation** — top-level political entity. Owns stations and ships. Defined in `data/nations.ts` with name pools, colors, lore, and naming conventions.
- **Station** — belongs to a nation. Has a type and size (S/M/L). Produces and consumes wares via inventory slots. Type definitions in `data/stations.ts`; initial placements per preset in `data/map-preset-*.ts` (reference map zones by id).
- **Ship** — belongs to a station (and by extension its nation). Has cargo capacity, speed, allowed wares, and hull geometry. Defined in `data/ships.ts`. Runtime ships orbit their home station and execute trade flights.
- **Ware** — goods produced, consumed, and transported. Structured as a tiered production chain (raw → refined → final → sinks). Defined in `data/wares.ts`.

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
- `src/tests/` — the only home for `*.test.ts` files.
- Simulation files use the `sim-*.ts` prefix (e.g., `sim-trade-manager.ts`, `sim-station.ts`). ESLint enforces no `phaser` imports and no DOM globals under `src/**/sim-*.ts`.
- Simulation models should not store render-only state (angles, sprites, selection). Simulation owns action-phase state — phase name, start time, duration, progress, logical positions — which is deterministic and serializable. Render owns exact angles, speeds, curves, and trail geometry, computed from sim state + wall clock each frame.
- Flight/travel endpoints are identified by logical location (station + surfaceOrOrbit), not by map coordinates. Map coords come from render.
- Entity state lives on the entity itself. Managers coordinate lifecycle; they must not duplicate state in parallel `Map<entityId, state>` structures. Read and write entity fields directly.

### Single source of truth

- CSS z-index values live as custom properties in `ui.css` `:root` (e.g., `--z-hud`, `--z-modal`, `--z-toast`). All call sites use `var(--z-*)`.
- Phaser depth values live as entries in `src/phaser/depth-layers.ts` `Layer` enum. No hardcoded numeric literals in `.setDepth(...)` calls.

### Where data lives

- `data/` holds game data and data-owned constants. Put canonical world definitions, map layout, economy numbers, and shared content values here.
- `src/` holds game engine and runtime code. Put helper functions and systems that operate on game data here, even when they are map-related.
- Keep `data/ships.ts` limited to ship type definitions and static ship data. Ship lookup helpers, runtime config, and behavior belong in `src/`.
- Apply the same rule to the rest of `data/`: mutable caches, random assignment, lookup helpers, HTML formatting, and render/runtime config belong in `src/`, not beside authored definitions.
- File naming conventions:
  - `data/visuals-*.ts` — visual-only tuning (colors, sizes, animation timings, camera tuning). Test: removing a value only changes how things *look*, not how the simulation behaves. Entity-scoped visual tuning stays entity-first (`data/ship-visuals.ts`, `data/station-visuals.ts`).
  - `data/controls-*.ts` — behavior/control tuning that isn't purely visual (e.g. `data/controls-camera.ts` zoom + drag friction + culling refresh; `data/controls-game-speed.ts` speed cycle).
  - `data/strings-{name}.ts` — extracted prose (lore, name pools, error text). Imported as `import * as X from "../data/strings-{name}"`; entries use `UPPER_CASE` keys (e.g., `sectorLore.UNDERLEAF`, `saveError.SLOT_EMPTY`).
  - `src/util-{name}.ts` — generic helper files (e.g., `util-ids.ts`).
  - `src/sim-*-template.ts` — entity authored-template lookups (e.g., `sim-ship-template.ts` exposes `getShipTemplate`).
  - `src/sim-*-types.ts` — runtime instance type definitions paired with authored shapes in `data/`. Examples: `sim-station-types.ts` (`Station`, `InventorySlot`, ...) pairs with `data/station-types.ts` (`StationTemplate`, `StationPlacement`, ...); `sim-map-types.ts` (`Sector`, `GameMap`) pairs with `data/map-types.ts` (`SectorTemplate`, `MapTemplate`).
  - `src/overview-{category}*.ts` — files that participate in overview-mode (e.g., `overview-system.ts`, `overview-trade-render.ts`, `ui-overview-nations.ts`). Parent-first naming for child extractions from a primary file (e.g., `station-render-selection.ts` is a child of `station-render.ts`).
  - `src/sim-trade-*.ts` — trade-system cluster split by concern. `sim-trade-manager.ts` owns the `TradeManager` class, active-ship registry, per-tick update loop, and snapshot capture/restore. Resolvers, observer registration, and the trade clock are instance methods on `TradeManager` — consumers thread the instance through. Sibling files split decision logic, queue + cargo mutations + the action-dispatch loop, reservation lifecycle, and HUD formatters. `sim-trade-types.ts` holds the shared types every sibling imports (`TradeShip`, `TradeTransferEvent`, `TradeReservation`, `TradeTripLeg`, `TradeDirection`, `ReservationCargoDirection`) plus the `getTotalCargo` helper; siblings import from `sim-trade-types`, not from each other or from the manager. Each file's top-of-file header is authoritative for its scope.
- Prefer flat-with-suffix naming over deep subfolder nesting. Alphabetical adjacency clusters related files (e.g., `sim-ship-manager.ts`, `sim-ship-template.ts`, `sim-ships.ts` sort together) and keeps a complete cluster visible in one directory listing.
- Type definitions: `data/nation-types.ts`, `data/station-types.ts`, `data/ship-types.ts`, `data/ware-types.ts`
- Data instances: `data/nations.ts`, `data/stations.ts`, `data/ships.ts`, `data/wares.ts`
- Map layout: `data/map-zones.ts` (all station footprints, `<sector>-<n>` ids), `data/map-sectors.ts` (sector grid with lore), `data/map-nebulas.ts` (nebula overlays). Combined into the `map` singleton in `data/map.ts`.
- Presets (initial seeding): `data/map-preset-{settled,frontier,blank}.ts` — each names initial station placements + economy tuning. Registered in `data/map-presets.ts`; the `presetById` lookup helper lives in `src/util-map-preset.ts`.
- Economy config: `data/economy-config.ts` (trade timing, fill thresholds, UI update rates).
- Lore lives inline on each entity as a `lore` field: `nation.lore`, `stationType.lore`, `ship.lore`, `sector.lore`.
- In-browser map/economy editor lives in `src/editor/`.

### Save/load

- Save schema is permanently `SAVE_VERSION = 1` during development. The game is pre-release — do not bump the version, do not write migration logic, do not add "v1 vs v2" comments or compatibility shims. Just edit the snapshot shape in place. The `version` field and its rejection check in `validateSnapshot` stay (that's the actual need).

## Phaser

- Built on Phaser v4.1.0.
- Phaser v4 differs substantially from v3 in both API and architecture. Online v3-era answers often look correct but aren't; prefer local references over web search.
- Render state type naming:
  - Per-entity visual holders → `*VisualBundle` (e.g., `StationVisualBundle`, `ShipVisualBundle`, `ShipTravelVisualBundle`). One per entity instance; holds Phaser game objects + per-entity render cache.
  - Scene-level visual subsystems → `*System` (e.g., `AmbientTrafficSystem`). One per scene; holds pooled objects + subsystem-wide state.
- `Bundle` is also available as a function-name suffix when grouping a small set of drawn visual items under one helper (e.g., `drawStationOrbitBundle` paints glow + ring + twinkles; `drawStationBodyBundle` paints core + stroke + icon + label). Not mandatory — consider it when the helper paints 2+ visually-related items composed together and a more specific noun (`Layer`, `Pass`) doesn't fit.
- Local references, both populated by `dev/fetch-phaser-docs.sh` (gitignored):
  - `dev/phaser-docs.local/` — typedoc-generated API reference HTML from Phaser's `.d.ts` files. Open `index.html` for browsing.
  - `dev/phaser-skills.local/` — AI agent skill folders, one per subsystem (cameras, sprites-and-images, render-textures, filters-and-postfx, game-object-components, scenes, tweens, input-keyboard-mouse-touch, tilemaps, v4-new-features, v3-to-v4-migration, etc.). Each contains a `SKILL.md` with task-oriented guidance, code examples, and API tables. Grep these first when you need subsystem-specific detail.

## Performance

- Cache reusable objects instead of recreating them. Example: `hud-icon-cache.ts` builds SVG data URIs once per (nation, type) key, then returns the cached string on subsequent calls. Apply the same pattern to any computed result that depends on stable inputs.
- Skip work for off-screen objects. Check viewport bounds before updating visuals - only render what the camera can see (see `isVisibleInViewport` in `src/phaser/viewport-culling.ts`).
- Throttle UI updates by priority: selected/focused elements update every simulation tick, background elements (unselected labels) update every Nth tick. See `shouldUpdateUI` and `focusedAttentionIntervalTicks` / `backgroundAttentionIntervalTicks` in economy config.
- Avoid per-frame DOM writes. Use the shared helpers in `src/ui-dom-cache.ts` (`setHtmlIfChanged`, `setTextIfChanged`, `setAttrIfChanged`) instead of writing per-class `last*` diffing fields. These helpers use a `WeakMap` per element to skip `innerHTML`/`textContent`/`setAttribute` when the value hasn't changed.
- Pool and reuse game objects (Phaser circles, sprites) via `GameObjectRenderPool` instead of creating and destroying them each frame.
