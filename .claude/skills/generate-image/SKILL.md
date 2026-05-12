---
name: generate-image
description: "[sky] Create or update procedurally generated game textures (nebulas, backgrounds, dark nebulas)"
allowed-tools: Read, Edit, Write, Bash(node *), Glob, Grep
---

# Generate Image

Create or modify procedurally generated image assets for the game.

## Context

This project uses Node.js scripts with the `canvas` library to procedurally generate PNG textures. The generation scripts live in `dev/images/` and output to `src/assets/backgrounds/`.

## Existing scripts

- `dev/images/generate-nebulas.mjs` — colored nebula textures (1500x1500)
- `dev/images/generate-dark-nebulas.mjs` — dark overlay nebulas (3000x3000)
- `dev/images/generate-overgrowth-nebula.mjs` — bespoke tree-like nebula variant
- `dev/images/generate-stars.mjs` — star field tile backgrounds (1024x1024, uses `sharp`)

## Best practices (MUST follow)

1. **Deterministic PRNG**: Always use `mulberry32` seeded via `hashStr`. Never use `Math.random()`.
2. **Phase-based RNG**: Use `phaseRng(id, phase)` to create separate RNG streams per layer/phase. This keeps each phase stable when other phases change.
3. **Fixed anchor positions**: Place cluster/blob anchors at hardcoded coordinates, not random ones. The RNG should only add jitter around fixed positions. This makes the output adjustable by tweaking coordinates rather than re-rolling.
4. **Density buffer workflow**: Use `Float32Array` density buffers with `splatDensity()`, then render via `renderDensity()` or `compositeLayer()`. This gives smooth, natural-looking results.
5. **Edge fade**: For textures that shouldn't tile, apply radial edge fade so they blend into the background.
6. **Multi-layer compositing**: Build up images in phases (base density, overlays, accents) composited onto a canvas.
7. **Minimal randomness**: Prefer fixed parameters (positions, angles, lengths) over random ones. Use RNG only for jitter and variation within fixed structures. The user prefers to adjust numbers rather than re-roll dice.

## Workflow

1. Read the closest existing generation script to understand the current pattern. Prefer `dev/images/generate-nebulas.mjs`, `dev/images/generate-dark-nebulas.mjs`, or `dev/images/generate-overgrowth-nebula.mjs` as references for deterministic nebula work.
2. Create or modify the appropriate script
3. Run it with `node dev/images/<script>.mjs`
4. If adding new textures, update:
   - `src/scenes/Game.ts` — add import, preload, and nebulaMap entry
   - `data/maps/forge/sectors.ts` — add preview sector if applicable

## Arguments

`$ARGUMENTS` — describe what image to create or modify (e.g., "make dark-nebula1 more opaque", "add a new red nebula variant")
