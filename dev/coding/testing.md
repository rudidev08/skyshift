# Skyshift testing conventions

Project-specific guidance read by `.claude/skills/review-tests/SKILL.md` when it dispatches mutation-testing subagents.

The orchestrator pastes:
- "Project conventions to add to each agent prompt" → into the agent prompt's `<Project conventions>` placeholder.
- The matching "Per-domain gotchas" bullet (per the assigned domain) → into the agent prompt's `<Per-domain gotchas>` placeholder.

The "Validation commands" and "Orchestrator reference" sections are for the orchestrator only — not spliced into agent prompts.

## Project conventions to add to each agent prompt

- Pre-release game: no save-format compat concerns, no migration logic.
- Tests run as plain `tsx` (no jsdom). Tests that need `localStorage` or `document` install lightweight Map-backed shims — preserve that pattern.
- Sim files (`sim-*.ts`) must not import Phaser. The sim/render boundary is enforced.

## Per-domain gotchas

Flag the matching bullet to the agent at dispatch when the assigned domain matches:

- **Sim files** (`*sim-*.ts`): rich numerical logic — many high-value mutation targets. Tests usually cover happy paths well; survivors cluster around edge cases (boundaries, empty inputs, exhausted resources).
- **UI / DOM-touching code** (`src/phaser/*`, `src/ui-*.ts`): tests stub `document` with a fake. Mutations to event-handler attachment may survive if the test doesn't trigger the handler. Watch for "no test exercises X" survivors.
- **Save/load** (`src/ui-savegame-manager.ts`, `src/storage-save-slots.ts`): tests usually cover round-trip but skip slot bounds and rotation. Survivors here are common.
- **Trade cluster** (`src/sim-trade-*.ts`): largest domain by line count. Reservation accounting and queue advancement are dense — pick mutations that affect cargo deltas, not just observability.
- **Audio / announcement data** (`src/audio-*.ts`): mostly pure transforms. Easy to write strong assertions; few survivors expected.

## Validation commands (orchestrator reference)

Skyshift uses these commands in the SKILL.md workflow placeholders:

- Pre-flight (workflow step 0): `npm test`
- Per-mutant test run (agent workflow per mutant, step 2b): `npx tsx <test file>`
- Final validation (workflow step 6): `npm test`, `npm run typecheck`, `npm run lint`

The user-level skill text uses generic placeholders (`<test command>`); the orchestrator substitutes Skyshift's commands when running this skill in the Skyshift project.

## Orchestrator reference: Skyshift-specific examples

These are illustrative anchors for the generic guidance in the user-level `review-tests` skill. **They are NOT spliced into agent prompts** — the orchestrator uses them when communicating with the user about specific Skyshift cases (e.g. when reviewing pruning candidates and needing to point at the canonical example).

- **Domain-balance example:** pairing a 2000-line trade cluster with a 100-line audio file under one agent wastes the small file's budget.
- **Common orphan branch:** dedup logic on a station type whose authored data has only one produced ware — the dedup never fires.
- **Examples of real-bug-not-test-gap survivors:** missing `Math.max(0, x)` clamps on `reservedIncoming` (downstream availability calc breaks); missing `takenCodes.add(code)` letting two zones share an id (registry lookup breaks).
- **Scenario-narration files** (don't prune even if they share setup with siblings): `src/tests/editor-edits-heuristic.test.ts`, `src/tests/savegame-snapshot.test.ts`.
