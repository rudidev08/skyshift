# Skyshift comments-style supplement

This file supplements the project-local comments-style guide at `.claude/skills/review-structure/structure-comments.md`. The base rules and worked examples live in that file; this supplement carries Skyshift-specific file-pattern guidance and concrete in-repo examples.

Tools that walk the comments rules read both files: base guide first, then this supplement as additions/overrides.

## Project file patterns

These map common Skyshift file patterns to specific gotcha classes plus concrete in-repo examples.

- **Data files** (`data/*.ts`) — see "Authored content / data files" gotcha. `description:` and `lore:` fields are DATA, not comments — don't touch them, even when they look like prose. Section dividers should carry grouping info hard to infer from the items below; pure category-restating dividers (`// Refined wares`, `// Final wares`) should go.
- **Sim files** (`sim-*.ts`) — see "Code with preconditions or invariants" gotcha. Precondition/invariant comments often look long but earn their length ("we already verified X in Y, so we don't re-check here"). Conservative bias is critical — the simulator depends on these invariants holding.
- **Phaser/render files** (`src/phaser/*.ts`, `src/render-*.ts`) — see "Performance-tuned code" gotcha. Perf/render comments often hide non-obvious WHY (off-screen culling, throttle reasoning, cache-key choice, frame-budget bailout). Preserve unless clearly redundant.
- **Audio / input / scheduling files** (`src/audio-*.ts`, input handlers, tick-scheduled code) — see "Async / event-driven code" gotcha. Example 4 of `.claude/skills/review-structure/structure-comments.md` is the target — concrete-scenario-with-bad-outcome (e.g. "while we were waiting on buffer loads, the user may have clicked another station…") beats internal-mechanism wording (e.g. "generation guard after every await"). Watch for rewrite candidates.
