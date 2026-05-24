# Skyshift deep-simplification supplement

This file supplements the user-global deep-simplification guide at `.claude/skills/deep-simplify/deep-simplify.md`. The moves, the behavior-change protocol, and the conservative bias live in the user-global file; this supplement carries the Skyshift runtime-invariant license list, concrete in-repo move evidence, and worked examples.

The `deep-simplify` skill (and any tool that walks the deep-simplify rules) reads both files: user-global first, then this supplement as additions/overrides. **Without this file's license list, no behavior-changing simplification is licensed** — the skill falls back to behavior-preserving only.

## Runtime-invariant licenses

A behavior-changing simplification must cite one of these by name, and ground it against the code per the protocol's "Verified against" rule. This list is authoritative for Skyshift; extend it from `AGENTS.md`, never invent one to justify a change.

- **The game loads once per session.** Lazy/deferred loading of bundled assets or data can be eager/synchronous. A "load on first use" path that only ever runs once is just load.
- **The bundled set is fixed and fully enumerated.** A parallel set/list rebuilt from a subset duplicates a map that already enumerates every entry — iterate the source, delete the parallel structure. (`67ebe9c`: deleted `preloadKeys` because the key→URL map already lists every bundled WAV.)
- **Pre-release; `SAVE_VERSION` permanently 1; snapshot edited in place.** No migration code, no forward/back-compat shims, no version branches beyond the single `validateSnapshot` rejection.
- **Users don't edit saves.** No defensive parsing of save data past the single `validateSnapshot` boundary.
- **No public API contract.** Single app, no external consumers, no stability promise (pre-release; `AGENTS.md`: no back/forward compat, users don't edit saves). The user-global Keep-signals' "documented public API contract" never fires here — cross-module and cross-entry shapes are co-editable internal coupling, governed by the import-direction/file-cluster + change-cadence Keep-signals, not by API stability.
- **Single-player, deterministic simulation.** No concurrency guards, no race handling, no re-entrancy defense.
- **`data/` is trusted internal input.** Validate only where untrusted data crosses in (save load). Collapse internal re-validation and "can't happen" guards on data-file-sourced values.
- **Simulation is headless / zero-Phaser.** Render-only state (angles, sprites, selection, exact positions) found in `sim-*` is misplaced and removable from the sim model.
- **Entity state lives on the entity.** A manager's parallel `Map<entityId, state>` that mirrors a field already on the entity is removable — read/write the entity field.
- **A stored field derivable from its siblings.** Drop the field, derive at the one read site, throw if the derivation contradicts the data (`0b81ef3`: `StationZoneTemplate.sectorId` → `findSectorAtPosition`, throw if outside every sector).

## Move evidence

Real Skyshift commits for each user-global move (M1–M9). Use these to recognize the shape in new code.

- **M1** — `6a33e26`: `balanceInitialInventory` + `groupInventorySlotsByWare` + `assignRandomFillsToWareTotal` + `universeWareFraction` → `randomizeInitialInventory`, one `Math.floor(max * random(lower, upper))` per slot. Behavior-changing; announced in the subject; shipped a guard test.
- **M2** — `0b81ef3`: `StationZoneTemplate.sectorId` removed from ~280 entries, resolved via `findSectorAtPosition`. `777bb8e`: `sectorEnvironmentOverride` removed; `zone.sectorEnvironmentOverride ?? zone.sector.environment` collapsed.
- **M3** — `642a50e`: `data/ui-preference-defaults.ts`; every `loadPreference("X", "true")` → `String(uiPreferenceDefaults.X)`. `bebd156`: `data/visuals-layers.ts` `Layer`.
- **M4** — `777bb8e`: `*Milliseconds` → `*Seconds` across `data/visuals-*`; `ringPulseDurationMilliseconds: 1000` → `ringPulseDurationSeconds: 1.0`; Phaser/`setTimeout` sites multiply by 1000. Behavior-preserving.
- **M5** — `c7768c9`: "authored"/"authoring" reworded to `template` / `the data files` / `predefined` / `hand-tuned`; `collectAuthoredSpeechStrings` → `collectCoreSpeechStrings`.
- **M6** — `be30aa0`: `StationTemplate` → `StationTypeTemplate`; `StationPlacement` → `PlacedStation`.
- **M7** — `777bb8e`: deleted `stationTypePluralName(template)`; callers read `.namePlural`. `bebd156`: `interface SectorGridMapDimensions {3 fields}` → `Pick<GameMap, "gridSizeX" | "gridSizeY" | "sectorSize">`.
- **M8** — `bebd156`: `setSectorGridAlpha`, `strokeGridLines` extracted.
- **M9** — `be30aa0`: `NationTemplate` JSDoc rewritten to effect-first.

## Examples

### Example 1

Prefer (M1, behavior-changing — license + original purpose + verified-against + announced + guarded):

```ts
// License: data/ is trusted internal input — cross-station scaling was the only consumer of the universe-wide pass.
// Original purpose: git log 6a33e26 — the universe-wide pass scaled per-ware totals to universeWareFraction.
// Verified against: sim-map-create.ts:120-160 — no caller depends on cross-station coordination.
// Subject: "Replace universeWareFraction with a plain per-slot inventory randomizer …"
export function randomizeInitialInventory(slot: InventorySlot) {
  slot.amount = Math.floor(slot.max * (lower + Math.random() * (upper - lower)));
}
// Guard test: "each slot depends only on its own max" — fails under the old universe-wide scaling.
```

Avoid: renaming `assignRandomFillsToWareTotal`'s locals and adding a comment explaining the scaling. The scaling itself is the complexity to remove, not to explain.

### Example 2

Prefer (M2, behavior-preserving — derivation provably yields the same sector):

```ts
const sector = findSectorAtPosition(sectors, x, y);
if (!sector) throw new Error(`zone ${id} at (${x},${y}) is outside every sector`);
```

Avoid keeping `sectorId` "so we don't recompute" — it's read once at seed time; the stored copy is denormalization defending against a cost that doesn't exist.

### Example 3

Prefer (M7 + the bundled-set-enumerated license):

```ts
// 67ebe9c: the key→URL map already enumerates every bundled WAV.
for (const url of Object.values(keyToUrl)) preload(url);
```

Avoid maintaining `preloadKeys` — a second set rebuilt from voice keys + preset names that can only ever be a subset of what the key→URL map already lists.

## Validation for behavior-changing items

Per `AGENTS.md`. After applying behavior-changing simulation items, `npm run typecheck` + `npm run lint` + `npm test` is the floor, not the ceiling — the economy/trade simulation is the real net:

- Economy report: `./dev/economy/report.sh`
- Trade/economy behavior: targeted `src/tests/*.test.ts` (economy, trade, station, emigration) + the economy report; for sweeping changes, `npm test`.
- UI/static-page changes: `node dev/static-tests/run-all.mjs` (needs `npm run dev`).

Report results in plain English ("typecheck clean, 41 tests pass, economy report unchanged"), not command names.
