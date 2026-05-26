# Skyshift structure-style supplement

This file supplements the project-local structure-style guide at `.claude/skills/review-structure/structure.md`. The base rules and worked examples live in that file; this supplement carries Skyshift-specific file-pattern guidance and project carve-outs.

Tools that walk the structure rules read both files: base guide first, then this supplement as additions/overrides.

## Project file patterns

These map common Skyshift file patterns to specific gotcha classes plus the relevant base rules.

- **Sim files** (`sim-*.ts`) — see "Code with preconditions or invariants" gotcha; rule D.1 (defensive guards justified by runtime correctness — preserve those that enforce real rules). Guards in these files often enforce real runtime invariants the simulator depends on.
- **Phaser/render files** (`src/phaser/*.ts`, `src/render-*.ts`) — see "Performance-tuned code" gotcha; rule B.5 (framework-prescribed lifecycles are exempt from "no init-then-do"). Phaser's framework-prescribed lifecycle methods are `init` / `preload` / `create` / `update`.
- **Manager files** (`*-manager.ts`) — see "Files with broad responsibility by design" gotcha; rule G.1 (a large file is a signal, not a verdict). `AGENTS.md` assigns broad ownership: `sim-trade-manager.ts` and `sim-emigration-manager.ts` are intentionally large (~700 lines each) — broad domain ownership is the design (e.g. `sim-trade-manager.ts` owns the active-ship registry, per-tick loop, snapshot capture/restore). The trade cluster's sibling-file split (`sim-trade-decision.ts`, `sim-trade-reservation.ts`, etc.) is the canonical example of how to decompose a manager when concerns genuinely separate.
- **Data files** (`data/*.ts`) — see "Authored content / data files" gotcha. Authored data only, not behavior — don't propose extracting from data declarations or `[DECOMPOSE]` on data files.
