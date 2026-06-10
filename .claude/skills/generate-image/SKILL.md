---
name: generate-image
description: "[sky] Create or update procedurally generated game textures (nebulas, backgrounds, dark nebulas)"
allowed-tools: Read, Edit, Write, Bash(node *), Glob, Grep
---

# Generate Image

## Context

- Node.js + `canvas` library generates PNG textures.
- Scripts live in `dev/images/`; output goes to `src/assets/backgrounds/`.

## Existing scripts

- `dev/images/generate-nebulas.mjs` — colored nebula textures (1500x1500).
- `dev/images/generate-dark-nebulas.mjs` — dark overlay nebulas (3000x3000).
- `dev/images/generate-overgrowth-nebula.mjs` — bespoke tree-like nebula variant.
- `dev/images/generate-stars.mjs` — star field tile backgrounds (1024x1024, uses `sharp`); stitches pre-made tiles, not procedural — reads source tiles from `local/images/`, not in the repo, so it won't run standalone.
- `dev/images/nebula-helpers.mjs` — exported helpers: `phaseRng`, `splatDensity`, `compositeLayer`. (`mulberry32`/`hashStr` are module-private PRNG primitives `phaseRng` wraps — import `phaseRng`, not them.)

## Rules

- Procedural textures use deterministic PRNG only — the private `mulberry32` seeded via `hashStr`, wrapped by exported `phaseRng`. Never `Math.random()`. (Tile-stitching pipelines like `generate-stars.mjs` are exempt.)
- Use `phaseRng(id, phase)` to give each layer/phase its own RNG stream, so phases stay stable when others change.
- Place cluster/blob anchors at hardcoded coordinates; RNG only adds jitter around fixed positions.
- Density-buffer workflow: `Float32Array` + `splatDensity()` (shared), then `compositeLayer()` (shared) or a per-script density-to-canvas function (e.g. `renderDensity` in `generate-nebulas.mjs`, `densityToCanvas` in `generate-dark-nebulas.mjs`).
- Apply radial edge fade for textures that shouldn't tile.
- Build images in phases (base density, overlays, accents) composited onto a canvas.
- Prefer fixed parameters (positions, angles, lengths); use RNG only for jitter. User adjusts numbers rather than re-rolls dice.

## Workflow

1. Read the closest existing script for the current pattern. Prefer `dev/images/generate-nebulas.mjs`, `dev/images/generate-dark-nebulas.mjs`, or `dev/images/generate-overgrowth-nebula.mjs` for deterministic nebula work.
2. Create or modify the appropriate script.
3. Run: `node dev/images/<script>.mjs`.
4. When adding new textures, update:
   - `src/phaser/backgrounds-render.ts` — asset import + `backgroundTextures` entry.
   - `data/map-nebulas.ts` — map placement if the texture appears in the game map.
5. After editing any `.ts` file in step 4, run `npm run typecheck` and `npm run lint` (AGENTS.md requires this after any `.ts` edit); fix anything they flag.

## Arguments

- `$ARGUMENTS` — describes what image to create or modify (e.g., "make dark-nebula-density-l more opaque", "add a new red nebula variant").
