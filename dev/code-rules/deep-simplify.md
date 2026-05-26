# Skyshift deep-simplification supplement

This file supplements the project-local deep-simplification guide at `.claude/skills/deep-simplify/deep-simplify.md`. The moves, examples, behavior-change protocol, and conservative bias live in that file; this supplement carries only the Skyshift runtime-invariant license list and validation expectations.

The `deep-simplify` skill (and any tool that walks the deep-simplify rules) reads both files: base guide first, then this supplement as additions/overrides. **Without this file's license list, no behavior-changing simplification is licensed** — the skill falls back to behavior-preserving only.

## Runtime-invariant licenses

A behavior-changing simplification must cite one of these by name, and ground it against the code per the protocol's "Verified against" rule. This list is authoritative for Skyshift; extend it from `AGENTS.md`, never invent one to justify a change.

- **The game loads once per session.** Lazy/deferred loading of bundled assets or data can be eager/synchronous. A "load on first use" path that only ever runs once is just load.
- **The bundled set is fixed and fully enumerated.** A parallel set/list rebuilt from a subset duplicates a map that already enumerates every entry — iterate the source, delete the parallel structure.
- **Pre-release; `SAVE_VERSION` permanently 1; snapshot edited in place.** No migration code, no forward/back-compat shims, no version branches beyond the single `validateSnapshot` rejection.
- **Users don't edit saves.** No defensive parsing of save data past the single `validateSnapshot` boundary.
- **No public API contract.** Single app, no external consumers, no stability promise (pre-release; `AGENTS.md`: no back/forward compat, users don't edit saves). The base guide's Keep-signals' "documented public API contract" never fires here — cross-module and cross-entry shapes are co-editable internal coupling, governed by the import-direction/file-cluster + change-cadence Keep-signals, not by API stability.
- **Single-player, deterministic simulation.** No concurrency guards, no race handling, no re-entrancy defense.
- **`data/` is trusted internal input.** Validate only where untrusted data crosses in (save load). Collapse internal re-validation and "can't happen" guards on data-file-sourced values.
- **Simulation is headless / zero-Phaser.** Render-only state (angles, sprites, selection, exact positions) found in `sim-*` is misplaced and removable from the sim model.
- **Entity state lives on the entity.** A manager's parallel `Map<entityId, state>` that mirrors a field already on the entity is removable — read/write the entity field.
- **A stored field derivable from its siblings.** Drop the field, derive at the one read site, throw if the derivation contradicts the data.

## Validation for behavior-changing items

Per `AGENTS.md`. After applying behavior-changing simulation items, `npm run typecheck` + `npm run lint` + `npm test` is the floor, not the ceiling — the economy/trade simulation is the real net:

- Economy report: `./dev/economy/report.sh`
- Trade/economy behavior: targeted `src/tests/*.test.ts` (economy, trade, station, emigration) + the economy report; for sweeping changes, `npm test`.
- UI/static-page changes: `node dev/static-tests/run-all.mjs` (needs `npm run dev`).

Report results in plain English ("typecheck clean, 41 tests pass, economy report unchanged"), not command names.
