# iterate-skill — convergence

This reference covers **defect identity**, **termination**, and **stuck detection** under the budget-capped shape. `references/spec.md` is the setup; `references/evaluate-and-fix.md` covers grading and fixing.

## Defect identity

Every defect gets a **stable id**, keyed on three structural fields:

```
<check-id>[(<sub-assertion>)]:<scenario-id>:<cut-point>
```

- **check-id** — the gated check that failed (from `test-spec.md` Part 3).
- **scenario-id** — the scenario that exposed it (`resume-mid-apply`, `edge-slug-collision`, etc.).
- **cut-point** — `mid-first-phase` / `between-phases` / `mid-apply` / `none`, or any other `Cut point` value a scenario defines (e.g. the frozen spec's `mid-MULTI-FILE-apply`).
- **sub-assertion** (optional) — when the failed check decomposes into independently-graded sub-assertions in `test-spec.md` (e.g. note-shape-pass2 (a)/(b)/(c)/(d)), the letter of the one that failed, e.g. `note-shape-pass2(a):S5:none`. Omit the `(…)` for a single-predicate check. The sub-assertion letters are frozen in `test-spec.md`, so they are as stable across attempts as check-id — a structural field, not the run-varying critique. Keying on them keeps two distinct root causes that share a check (one fixed, a different one newly failing) from colliding on one id.

Example: `resume-position-correct:resume-mid-apply:mid-apply`.

The id is **structural, not descriptive.** It's NOT keyed on the orchestrator's plain-language critique (which varies between runs even for the same bug), NOR on where the symptom manifested (e.g. `progress.md` vs `plan.md` — the orchestrator's wording for the affected artifact also varies). A non-structural id would fragment a single root cause into multiple ids and let stuck-detection miss survivors. The three structural fields are stable across attempts.

## Termination — three exits

The loop stops in exactly one of three ways:

1. **All defects resolved.** Every defect in `defects.md` is marked `fixed`, `stuck`, `stuck (oscillation)`, or `spec-drift-flagged`. The candidate has stopped producing observable failures within budget; proceed to Done stage and write the report.
2. **Budget exhausted.** The 40-iteration-clear cap binds before all defects resolve. Remaining open defects land in `report.md` as `unresolved-budget-out`. The candidate is **not promoted** — iterate-skill never claims a success it did not reach.
3. **Per-defect stuck** (does not halt the loop). A defect's 2-attempt budget is spent without a clean retry, oscillation is detected, or spec-drift refusal fires. Mark the defect (with sub-reason as appropriate) and move to the next. The loop continues; surfacing happens in `report.md` at Done stage.

The first two are loop-level exits; the third is a per-defect outcome that accumulates without halting.

## Stuck detection — per defect

A defect is **stuck** when:

- **Defect survived its 2 attempts.** The second fix attempt's retry surfaces the same defect (same `<check-id>[(<sub-assertion>)]:<scenario-id>:<cut-point>`). The fixer's two shots are spent; throwing more fixes at it would reproduce the exact failure mode iterate-skill exists to cure. Mark `stuck`.
- **Oscillation (A↔B cycle).** A fix attempt's retry surfaces a new defect whose structural id matches a `fixed` row in `defects.md`. Fixing the current defect reintroduced an earlier one — the loop is about to enter an A↔B cycle. Mark BOTH defects `stuck (oscillation)` and surface the pair. The orchestrator can't break the cycle mechanically; the user decides. Lookup against rows in any OTHER status (`stuck`, `stuck (oscillation)`, `spec-drift-flagged`, currently-open) is NOT oscillation — that's the same defect's symptom resurfacing, so log as observed-again and don't append a duplicate. The oscillation check fires for every new defect a fix retry surfaces.
- **Spec drift refusal.** A planned edit would remove or rename a section, step name, identifier, or file path that any `test-spec.md` Part 3 `how to verify` clause references. The orchestrator does NOT apply; mark `spec-drift-flagged`. The frozen spec can't be amended mid-run.

A fix attempt's retry may surface **new defects** distinct from the one under repair. Each is appended to `defects.md` as an ordinary capped defect (its own 2-attempt budget) and processed when the queue reaches it — see SKILL.md Iterate step 4. There is no separate cascade or depth bookkeeping: the per-defect 2-attempt cap and the 40-clear ceiling bound any fix-induced chain, and oscillation (above) catches the one case the cap alone wouldn't — a fix reintroducing an already-`fixed` defect.

Surface every `stuck`, `stuck (oscillation)`, and `spec-drift-flagged` defect in `report.md` at Done stage with: the defect id, the attempted fix(es) as diffs (from `fix-attempts/`), and a one-line "what to consider" — a fix may need a judgment call the orchestrator can't make, the check may be wrong, or the candidate may need redesign beyond what the loop covers.

## High env-failure rate — surface, don't halt

Within the Investigate stage, if at least 3 scenarios have been graded (a `run …` Log line written, including env-failed ones) AND ≥50% of those scenarios had a nonzero `env` count in that line, surface a non-halting warning in the chunk summary:

> `iterate-skill: high env-failure rate (<X>/<Y> scenarios) — orchestrator may be off-rails, or the environment is genuinely unstable. Review recent runs before continuing.`

The loop does not halt; the user reads the chunk summary at the next `/clear` and decides whether to continue, switch model, or reset. A per-scenario retry rule still applies (a 3rd `environment` failure on the same scenario+check surfaces individually per `references/evaluate-and-fix.md`).
