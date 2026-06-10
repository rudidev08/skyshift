# iterate-skill — evaluate and fix

This reference covers the **grade → classify → fix** half of the loop. `references/spec.md` is the setup (the frozen spec); `references/convergence.md` covers defect identity, termination, and stuck detection.

Under the budget-capped shape, the orchestrator grades inline and fixes inline — no separate judge or fixer subagent. The independence-by-different-agent property is traded for the budget cap: a buggy orchestrator can only burn its 70-clear ceiling before stopping. The mitigations below replace independence with deterministic mechanics.

## What a run is judged on

Three kinds of defect:

- **Orchestration integrity** — no stall, no lost or duplicated state, ledgers consistent, resume-after-`/clear` correct, phase hand-offs intact, a defined terminal state reached. Objective.
- **Objective contract conformance** — the run produced what `candidate/SKILL.md` verifiably requires: required fields present, no leaked rule codes, the right pass over the right files. Objective.
- **Judgmental conformance and taste** — anything needing a judgment call.

The first two are **gated checks**; the third is **non-gating notes**. `references/spec.md` Part 3 defines the buckets and the classification rule; the frozen `test-spec.md` carries the actual per-target list.

## Inline grading — mechanical observables only

The orchestrator grades inline against `test-spec.md` Part 3, immediately after each scenario run (Investigate stage) and after each retry (Iterate stage).

Grading the same gated check across scenarios reuses one extraction predicate per check, not a fresh per-scenario re-derivation — the `references/spec.md` Part 3 § Verify-clause robustness "shared extraction criterion" applies to the grading side too: define each check's parse/match once and reuse it, so a corrected check (a demotion, a tightened regex) is fixed in one place, not re-applied per scenario.

**Mitigation against orchestrator-as-grader bias:** gated checks must be deterministic assertions over named artifacts. Each check's `how to verify` clause reduces to:

- "Line X of file Y matches pattern P," or
- "Subagent return contains / lacks Z," or
- "File counts at runtime path Q satisfies inequality R," or
- An equivalent objective predicate.

**Carve-out: orchestrator tool-call ordering is not gated.** In the inline-run model the orchestrator both drives the candidate and grades the run; there is no durable transcript of which tools fired in what order, and post-`/clear` the conversation log is gone. A check that asks "did the candidate execute tool X after tool Y" is orchestrator self-attestation, not a deterministic assertion over a named artifact. Such checks belong in non-gating. If the candidate's contract genuinely requires a specific call ordering to be verifiable, the candidate itself must write a durable artifact — a progress-file line, a sidecar log entry — that a gated check reads.

Anything requiring judgment (does the prose read well? is the proposal appropriately grounded?) is **non-gating** by definition. If a "must" from `SKILL.md` can't be reduced to a deterministic assertion, it's a non-gating note. Borderline cases go to non-gating.

This is the same rule from `references/spec.md` Part 3, sharpened. The orchestrator follows it both at extraction time (Plan stage) and at grading time (Investigate/Iterate).

**Primary evidence is the target's own progress files.** A multi-phase, crash-resilient candidate writes rich ledgers — per-outcome lines, plan generations, per-file notes — and most gated checks ask exactly what those ledgers record. Run output (terminal messages, user-facing wording) is secondary, used only for what no progress file holds. If a target's progress files turn out too thin for a check to be settled from them, that is itself a finding — the target should be recording that state — surfaced, not worked around.

**Re-confirm every FAIL before recording it.** A single grading command can lie — garbled or phantom output from a flaky tool channel, or a loose pattern matching the orchestrator's own prose instead of a real artifact line — and because a recorded `contract` defect drives a candidate edit, a false FAIL on a clean candidate manufactures a spurious fix. So no FAIL becomes a defect on one command's say-so: confirm it with a second, precise, disk-authoritative check before classifying — an anchored pattern (a reserved-token prefix like `^- pass-2-baseline:`, never a loose substring) and/or an independent filesystem read (`diff -rq`, `shasum`, a re-grep on the named artifact). A FAIL that flips to PASS on a clean re-check was a phantom. The re-confirm burden falls on FAILs because a phantom PASS only defers a real defect to the next signal, while a phantom FAIL fabricates one.

## What grading produces, per scenario

- Every **gated check the scenario exercises** → a binary `pass` or `fail`.
- Every **non-gating note** → a written observation appended to `report.md` under a `### Run <run-id>` header.
- Every gated-check **failure** → a pinpoint, appended as a row to `defects.md`:
  - **Defect id** — the structural id (format in `references/convergence.md`).
  - **Failed check** — the check id from `test-spec.md`.
  - **Offending instruction** — exact text from `candidate/SKILL.md` (or named reference file), with file path and a short anchor snippet. If the failure is a gap (candidate silent), name the section where the missing instruction belongs.
  - **Critique** — plain language: what the instruction fails to say, says ambiguously, or says wrongly. Describes the gap; does not prescribe the edit.
  - **Evidence** — the specific progress-file line or run output that shows the failure.
  - **Classification** — `contract` or `environment` (below).

## Classification — contract vs environment

A failed check is not always the candidate's fault.

- **`contract`** — the candidate's fault. The run followed `candidate/SKILL.md` and the bad outcome still resulted, OR the candidate is silent or ambiguous on the situation. Contract failures get a fix attempt.
- **`environment`** — not the candidate's fault. Sub-reasons:
  - `flaky-subagent` — a subagent the run dispatched crashed or returned malformed output for reasons unrelated to its prompt;
  - `rate-limit` — an API quota was hit;
  - `fixture-error` — the fixture itself was malformed (a validation command that can't run, a missing rule file);
  - `spec-error` — the frozen test spec or a verify clause is too narrow, contradictory, or depends on a candidate-output assumption the contract doesn't guarantee (per `references/spec.md` Part 3 § Verify-clause robustness). Distinct from `fixture-error` (about the fixture artifact). Both are structural.
  - `refusal` — the model refused part of the task;
  - `harness` — a Claude Code tool error unrelated to the candidate.

**Err toward `environment` when attribution is unclear.** Mislabeling environment-as-contract feeds a non-bug to the fixer, which then adds machinery — the exact failure mode iterate-skill exists to cure. Mislabeling contract-as-environment only delays catching it (the defect resurfaces on retry).

Transient sub-reasons (`flaky-subagent`, `rate-limit`, `harness`) trigger a retry of that scenario, max twice. A third `environment` failure on the same scenario+check is surfaced to the user as persistent — it may be a real contract defect the orchestrator is mis-attributing, or a genuine environment issue only the user can clear. Structural sub-reasons (`fixture-error`, `spec-error`, `refusal`) surface immediately — a `fixture-error` or `spec-error` means the frozen spec is wrong, so the orchestrator pauses and surfaces it rather than silently patching (which would un-freeze the spec mid-run). The user resolves by resetting with a corrected spec, recording an explicit waiver in `report.md`, or accepting the error.

Environment failures never become `contract` defects; they never reach the fixer.

## Inline fixing — the quote-the-pinpoint rule

The orchestrator applies fixes inline during the Iterate stage. **One attempt** = read defect row + apply edit + reset workspace + run retry scenario + grade.

**Mitigation against orchestrator-as-fixer bias:** before applying any edit, the orchestrator quotes the defect's row from `defects.md` **verbatim** (id, failed check, offending instruction, critique, evidence). The fix may address only what the quoted row names — no drive-by edits, no nearby cleanup, no "while I'm here" changes informed by the orchestrator's runtime experience of the scenario.

This is the isolation a separate-agent fixer got for free (it only saw the defect row, not the runtime). Quoting verbatim is the inline equivalent.

## The simplification mandate

The inline fixer works under a hard mandate:

- **Smallest fix.** Address exactly the pinpointed gap and nothing else.
- **Clarify or remove before adding.** A defect almost always means an instruction is ambiguous, contradictory, or wrong — so the fix is almost always to *clarify* the offending instruction or *remove* the one that contradicts it. *Adding* a new rule is the last resort, taken only when the candidate is genuinely silent on a situation it must cover.
- **Refuse spec-drift edits.** If a planned edit would remove or rename a section heading, step name, identifier, or file path that any Part 3 `how to verify` clause references, the orchestrator does NOT apply it. Mark the defect `spec-drift-flagged` in `defects.md`, append to `report.md`. The user resolves by resetting with a corrected spec, accepting the drift, or fixing it manually.

An unconstrained fixer reproduces the exact failure iterate-skill exists to cure: every fix that adds machinery becomes the next iteration's bug. Fix small, fix subtractive when possible.

## After each grade — what gets written

**Per scenario run (Investigate stage):**

- Append a Log line to `progress.md`: `run <run-id>: <scenario-id> — <P>/<T> gated pass; contract <defect-id,…|none>; env <count>`.
- For each new contract defect: append a row to `defects.md` with id, scenario, check, observation, classification.
- For each non-gating observation: append under `### Run <run-id>` in `report.md` (if the header isn't already there from a prior resume).

**Per fix attempt (Iterate stage):**

- Before edit: `cp -R candidate fix-attempts/defect-NN-attempt-MM/`.
- After edit: append a Log line: `attempt: defect-NN-attempt-MM applied — <one-line summary of edit>`.
- After retry+grade: append a Log line `attempt: defect-NN-attempt-MM graded — <persists|fixed|stuck|stuck (oscillation)>` (mirrors the Investigate `run <run-id>: <P>/<T> gated pass` line; SKILL.md's mid-attempt-resume detection in Iterate step 1 keys off the presence of this grade line — every retry outcome appends it, an oscillation outcome included, so the `cleared-at` marker never dangles). Then update the defect's row in `defects.md` in place. An oscillation outcome appends this Log grade line even though its rule says not to append a new `defects.md` *row* — the Log line and the row are separate. Terminal statuses: `fixed` / `stuck` / `stuck (oscillation)` / `spec-drift-flagged`. The only transient intermediate is `persists` (defect survived attempt 1, attempt 2 pending). A defect transitions on its own grade — a cleared defect becomes `fixed` — except when its retry surfaces an oscillation (a new defect matching a `fixed` row), which supersedes the clear to `stuck (oscillation)` (per SKILL.md Iterate step 4), and any new defect the retry surfaced is appended as its own capped row (per SKILL.md Iterate step 4), so an oscillation lookup against a cleared defect's id matches its `fixed` row. If the Iteration budget binds (40 clears used) before all defects reach a terminal status, remaining open defects are recorded in `report.md` under the report-only category `unresolved-budget-out` — NOT a `defects.md` row status.
- For a new defect surfaced by a fix: append a new row at the end of `defects.md` (processed in queue order, per SKILL.md Iterate step 4).

**Stage counters tick in `/clear`-rhythm step 1 (per `/clear`), not per scenario or per attempt** — see SKILL.md `/clear`-and-resume rhythm. Do not increment counters in the per-scenario or per-attempt writes above.

## Snapshot retained, not verified

Pre-fix snapshots live in `fix-attempts/defect-NN-attempt-MM/` and are cheap audit trails — the final `report.md` includes the diff from each attempt for the user's review. Snapshots are **not** verified by line-count or file-count cross-checks (the old M-window machinery's safety nets are gone); if a mid-fix crash leaves `candidate/` in an inconsistent state, the user redoes the attempt from the snapshot manually.

## Where evaluation output lives

- `defects.md` — one row per defect, status updated in place across the run.
- `report.md` — running user-facing report: non-gating observations, surfaced environment failures, spec-drift flags, the final per-defect summary at end of run.
- `progress.md` Log — chronological per-run + per-attempt entries.
- `fix-attempts/defect-NN-attempt-MM/` — full `candidate/` snapshots, one per fix attempt.
