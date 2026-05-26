# iterate-skill — convergence

This reference covers **defect identity**, **the regression suite**, and the **three ways the loop stops**. `references/spec.md` is the setup; `references/evaluate-and-fix.md` is the evaluate/classify/fix step. This file is what turns a stream of runs into a verdict.

## Stable defect ids

Every defect found this run gets a **stable id**, keyed on five structural fields:

```
<branch>:<check-id>:<scenario-id>:<cut-point>:<affected-artifact>
```

- **branch** — `fixture` (a loop run against `fixture/`) or `held-out` (the post-convergence held-out pass against `held-out/`). The branch axis keeps a held-out re-discovery from colliding with the prior `fixed@iter-NN` ledger entry — held-out defects always land on a different id than fixture defects, even when every other field matches.
- **check-id** — the gated check that failed (from `test-spec.md` Part 3).
- **scenario-id** — the scenario that exposed it (`resume-mid-apply`, `edge-slug-collision`, and the like).
- **cut-point** — `mid-first-phase` / `between-phases` / `mid-apply` / `none`.
- **affected-artifact** — where the defect shows up: `progress.md`, `plan.md`, `notes/`, `user-facing-text`, and the like.

Example: `fixture:resume-position-correct:resume-mid-apply:mid-apply:progress.md`.

The id is **not** keyed on the judge's wording. The judge writes a fresh plain-language critique every run; the wording varies even when the defect is identical. A wording-based id would make the same defect look new each run — and then the regression suite could not recognize a returning defect, and stuck-detection could not tell that a defect survived its fix. The five structural fields are stable across runs, so the same defect always lands on the same id.

## The regression suite

`regression-suite.md` accumulates **every defect ever found this run**, each as a concrete **replayable case**:

```
## <defect-id>
- Scenario: <scenario-id>
- Inputs: <fixture delta, or "fixture baseline">
- Cut point: <cut-point>
- Failed check: <check-id>
- Expected assertion: <the concrete progress-file / transcript assertion that must hold>
- First found: iteration <N>
- Fixed: iteration <N> — <one-line fix summary>   (or "open" until a fixer pass addresses it)
```

The suite only ever grows — a defect is never removed once found. A converged candidate must pass the **whole accumulated suite**. Cases still marked `open` at an iteration-cap exit are exactly the "open defects" the final report lists.

Replaying the suite is **not extra runs**. Every scenario run is judged against every check in `test-spec.md`, so a run of scenario S automatically re-tests every regression case whose scenario is S. The regression suite is the explicitly-tracked set of proof obligations — every defect once fixed must stay fixed — and it is what stuck-detection and the "did the fix hold" check key on.

## What each iteration runs

An **iteration** is one fix cycle (`references/evaluate-and-fix.md`). Within it the loop:

1. **runs scenarios** — enough fresh runs to bring every scenario to M runs since the last candidate-changing fixer pass (M below);
2. **judges** each run against every check; new gated failures become new pinpoints and new `regression-suite.md` cases;
3. **fixes** — one fixer pass over the iteration's deduplicated `contract` defects. If the iteration produced zero `contract` defects, the fixer is **not dispatched** — the orchestrator records `fixer-pass iter-<NN>: no-defects` in the Run log and `iter-<NN>: no-defects` in the Iteration markers (the Phase 2 loop in `SKILL.md` pins the exact entries). The M-window does not reset, so the clean runs continue to count toward convergence.

A run classified `environment` and retried does not count toward M; its retry does.

## Repeated sampling, not seeds

iterate-skill cannot pin a deterministic seed — the CLI offers no such control. LLM runs are noisy: the same candidate, the same scenario, can pass once and fail once. So convergence is a **defect-rate judgment over repeated samples**, never a single green run. The run environment — model id, CLI version, relevant settings — is recorded in `progress.md` at run start; the convergence verdict is scoped to that recorded environment.

The repeated samples are also what *detect* an intermittent defect. A gated check that passes some of M runs and fails others is itself a real finding: the candidate is ambiguous enough that the orchestrator LLM sometimes goes wrong on it. An intermittent gated failure is classified `contract` and fixed like any other — the M-run window exists to **detect** such defects, not to **tolerate** them. Genuine environment noise is handled separately, by the `environment` classification and retry.

## Convergence

The loop has converged when, **since the last candidate-changing fixer pass**:

- every scenario has been run at least **M times** (default M = 5, tunable);
- every **gated check** passed in at least **N of those M** runs of every scenario (default N = M — a zero tolerated defect rate; lower N only deliberately, accepting a residual rate);
- the full **regression suite** passed in those runs.

A **candidate-changing fixer pass** is one whose Run log entry is `fixer-pass iter-<NN>: applied <count>` with applied count > 0. The other two pass kinds — `flagged <count>` (every defect skipped by the size gate, no edits applied) and `no-defects` (the iteration had nothing to fix, no fixer dispatched) — leave the candidate unchanged, so prior runs remain valid evidence. **The M-window resets only on `applied`.** Convergence can therefore land on a `no-defects` iteration: if the prior `applied` pass was far enough back that every scenario has accumulated M passing runs since, and no `contract` defects have surfaced since, the loop converges without another applied fix.

The orchestrator finds "the last candidate-changing fixer pass" by scanning the Run log backward for the most recent `fixer-pass iter-<NN>: applied <count>` entry; the runs after that entry are the M-window. If no `applied` entry exists yet (early iterations, no fix has landed), the M-window starts at the run log's first entry.

On convergence, the **held-out set runs once**.

## The held-out branch

After the loop reports convergence, the scenario catalog runs against `held-out/` instead of `fixture/` — M runs per held-out scenario, judged the same way. This pass happens **once**; it is never iterated on.

- **Held-out passes** — every gated check green across the held-out runs → the candidate generalized. It is good; hand off to the user for promotion.
- **Held-out fails** → **promote nothing.** The sample-set convergence was **overfitting** — the loop tuned the candidate to pass `fixture/`'s specific scenarios, and held-out shows it did not generalize. Report the held-out defects as the real verdict. **Do not loop on them.** Fixing against the held-out failures would spend the held-out set as just another training fixture, leaving no independent overfitting check for the next run. The held-out set is single-use by design.

## Termination — the three exits

The loop stops in exactly one of three ways:

1. **Converged.** Convergence reached, then the held-out pass runs once. Held-out passes → the candidate is ready; hand off for promotion. Held-out fails → promote nothing; report the held-out defects as the verdict.
2. **Iteration cap hit.** A hard cap on fixer passes (default ~10, tunable) is the backstop. Reached without convergence → stop and report "not good enough — here are the open defects," listing the `open` `regression-suite.md` cases. iterate-skill never claims a success it did not reach.
3. **Stuck.** A defect survives its fix, the loop oscillates, or two iterations in a row are flagged-only (size gate blocks every fix) → pause and surface to the user (below).

Whichever exit fires, the outcome is written to `report.md` and the run stops. Promotion to `.claude/skills/` is always the user's separate step — iterate-skill never installs.

## Mid-iteration surfacing

A non-halting warning the orchestrator outputs when a pattern suggests the iteration isn't measuring the skill cleanly — distinct from stuck detection (below), which halts the loop. Surfaced conditions also land in the chunk summary line (`SKILL.md`'s `/clear`-and-resume rhythm, step 2) so the user reads them at the next `/clear`.

**High env-failure rate within an iteration.** Within an iteration, if at least 3 runs have completed AND ≥50% of those runs are classified `environment`, surface: `iter-<NN>: high env-failure rate (<X>/<Y> runs) — orchestrator or judge may be off-rails, or environment is genuinely unstable. Review recent transcripts before continuing.` The loop does not halt; the user reads the chunk summary and decides whether to continue, switch to a stronger model, or reset. The existing per-check env-retry rule (3rd env failure on the same scenario+check surfaces) catches isolated unstable checks; this aggregate rule catches the spread case where env failures cluster across many scenarios+checks, which usually means the orchestrator is mis-driving rather than the environment is shaky.

## Stuck detection

Three conditions mean the loop is stuck and must stop fixing:

- **A defect survived its fix.** A defect id that was successfully **applied** by a fixer pass (not flagged by the size gate, not the no-defects case where no fixer ran) reappears in the very next iteration's runs. The fixer got its one shot and the fix did not take — throwing more fixes at it is exactly the machinery-accretion failure mode iterate-skill exists to avoid. A defect ledger entry of `flagged@iter-NN` is NOT subject to stuck-detection: no edit landed, so reappearance is expected — the defect stays `flagged@iter-NN` until the user acts on the size-gate-flagged report.
- **Oscillation.** The set of open defect ids repeats a set the loop has held before — fix A reintroduces defect B, fix B reintroduces defect A. The loop has visited this state and is going in circles.
- **Repeated flagged-only iterations.** Two iterations in a row where the Run log records `fixer-pass iter-<NN>: applied 0 | flagged <count>` — the size gate has blocked every planned fix two iterations running. The candidate cannot grow past the gate and the loop has nothing else to try.

The first two detections rely on the **stable defect id**: they compare defect ids across iterations, which only works because the id is structural, not wording-based. The third reads only the fixer-pass Run-log entries.

On any of the three conditions the loop **pauses and surfaces to the user** — which defect is stuck, which two states it oscillates between, or that the size gate is blocking all progress — with the relevant `iterations/iter-NN.md` records. It does not keep iterating. A stuck defect needs human judgment: the fix may need a call the fixer can't make, the check may be wrong, the size gate may need raising, or the skill may need a redesign beyond what the loop can do.
