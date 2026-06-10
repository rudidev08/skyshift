---
name: iterate-skill
description: "[rp] Test-and-fix a target skill within hard budget caps (30 investigation clears + 40 iteration clears). User-initiated; never auto-trigger on mentions."
allowed-tools: Agent, Read, Write, Edit, Bash(bash .claude/skills/iterate-skill/scripts/start-zellij-iterate.sh *), Bash(bash .claude/skills/iterate-skill/scripts/work-folder-name.sh *), Bash(mkdir:*), Bash(cp:*), Bash(rm:*), Bash(ls:*), Bash(git:*), Bash(diff:*), Bash(printf:*), Bash(cat:*), Bash(grep:*), Bash(wc:*), Bash(awk:*), Bash(python3:*), Bash(test:*), Bash(sed:*), Bash(find:*), Bash(mv:*), Bash(touch:*)
---

# Iterate Skill

## Goal

- Empirically test-and-fix a target skill's `SKILL.md` within hard budget caps: run scenarios, observe defects, apply fixes, retry. Stop on budget exhaustion or all defects resolved.

## Activation

- `/iterate-skill <target>` — `$ARGUMENTS` names the target skill folder or skill name.
- Empty `$ARGUMENTS` → list `iterate-skill-*.local/` folders at repo root; ask resume which / start fresh on what.

## Run mode

- Run in the orchestrator's interactive session — not a subprocess, not a subagent. Candidate may dispatch its own subagents — reproduce those subagent prompt templates verbatim, substituting only the candidate's documented placeholders (`references/spec.md` § Running a scenario).
- Run scenarios by following candidate `SKILL.md` **as a file** (mechanism: `references/spec.md`); never `/`-invoke the live installed skill.
- Candidate runs under iterate-skill's `allowed-tools`, not its own (file-based runs don't bind frontmatter); the candidate's own `bash <script>` calls are cleared by the auto-mode classifier at run time. Plan step 1 refuses only a candidate needing a capability iterate-skill genuinely can't perform or get cleared.
- Never touch the live skill in `.claude/skills/` until promotion is approved.
- Start Claude inside zellij first so the auto-clear hook drives `/clear`-and-resume unattended: `bash .claude/skills/iterate-skill/scripts/start-zellij-iterate.sh` from the target repo. Per-repo default session; pass a session name for parallel runs. Outside zellij every `/clear` is manual.

## Budget caps

- **Investigation: max 30 clears.** Every `/clear` from this pool counts: Plan-stage canary clears (step 6), Investigate fresh scenarios, mid-scenario resume continuations, env retries.
- **Iteration: max 40 clears overall.** Backstop; aborts with whatever defects remain.
- **Per defect: max 2 attempts.** One attempt = apply fix + run retry + grade. Typically one `/clear` per attempt; a resume-shaped retry may span two.
- **Fix-induced defects are just defects.** Append one surfaced by a fix attempt as another capped defect (own 2-attempt budget), processed after those already queued. No depth tracking, no cascade handling — the per-defect cap plus the 40-clear ceiling bound any chain.
- Both counters tick once per `/clear` from their pool (`/clear`-rhythm step 1); `Investigation:` also absorbs Plan-stage canary clears from the same 30-clear pool. They count `/clears`, not scenarios or defects.
- Total clear ceiling: **70** (30 + 40).

## Work folder

- Path: `iterate-skill-<target>.local/` at repo root. Resolve via `bash .claude/skills/iterate-skill/scripts/work-folder-name.sh <target>` (deterministic against model drift; do not interpolate).
- Layout:
  - `progress.md` — ledger and resume anchor (format below).
  - `test-spec.md` — frozen test plan: inputs, scenarios, gated checks. Written at end of Plan.
  - `triple-check-brief.md` — check-indexed audit table the orchestrator writes at step 7 and hands to the `/triple-check` reviewers.
  - `defects.md` — per-defect status rows; appended during Investigate, rewritten in place during Iterate.
  - `candidate/` — copy of the target skill; the fixer edits this.
  - `fixture/` — pristine git repo the scenarios run against. Only `fixture-assembler` writes here; any stray file rides along in `cp -R fixture workspace` and skews the scenario's `git status`. Every other run artifact lives at the work-folder root, never inside `fixture/`.
  - `canary-output/` — Plan step-6 canary captures, organized `<artifact-family>/<state>/`. At work-folder root.
  - `scenario-cuts/` — stateless targets only: the frozen `edge-partial-write-resume` cut content (`<scenario-id>.md`), pre-computed at Plan stage and copied into `workspace/` per attempt. At work-folder root.
  - `run-output/` — per-scenario captures of a stateless candidate's final message (`<scenario-id>.txt`), for non-gating checks that read run output. At work-folder root, never inside `workspace/` (see the `fixture/` note).
  - `workspace/` — current scenario's working copy of `fixture/`. Reset before each fresh scenario run; not reset on mid-scenario resume.
  - `fix-attempts/` — per-attempt snapshots: `defect-NN-attempt-MM/` (full `candidate/` copy pre-edit).
  - `report.md` — running final report.
  - `next-prompt.txt` — one-line resume prompt for `/clear`.

## `progress.md` format

```
# iterate-skill progress — <target>

Target: <path to live target skill>
Checkout-Root: <absolute physical repo-root path>
Checkout-Ref: branch:<name> | detached:<sha>
Environment: model <id>, CLI <version>
Started: <date>

Stage: <plan | investigate | iterate | done>
Investigation: <X>/30 clears used
Iteration: <Y>/40 clears used; <A> fixed, <B> stuck, <O> stuck (oscillation), <D> spec-drift-flagged, <E> remaining (open defects not yet terminal)
Current: <scenario-id | defect-NN | none>

## Log
- <one line per event; per-defect status rows rewritten in place>
```

- Header block + four state lines (`Stage`, `Investigation`, `Iteration`, `Current`) rewritten in place each chunk. Exception: the two `Checkout-*` lines record the **baseline** checkout — captured once at fresh start, carried forward unchanged, never rewritten (promotion compares the current checkout against this baseline; rewriting each chunk defeats that comparison).
- Log section append-mostly; exception: per-defect status rows rewritten in place.
- Resume reads `Stage` + state lines + Log to reconstruct position.

## Run start — fresh or resume

If `iterate-skill-<target>.local/progress.md` exists and is readable:

- **Reconcile target.** Compare `Target:` to `$ARGUMENTS`. Differ → surface mismatch and stop; user decides reset / rename / correct invocation.
- **Resume.** Invoking message starts with `[iterate-skill-resume]` → resume silently. Otherwise ask resume / reset.

Folder absent or `progress.md` invalid:

- Invocation starts with `[iterate-skill-resume]` → **stop and surface, do not fresh-start** (the sentinel means a run was expected here; a missing/invalid `progress.md` likely means the resume fired in the wrong cwd/checkout, and fresh-starting would create a run in the wrong tree — the user reconciles).
- Otherwise fresh start: create subtree, copy target to `candidate/`, write initial `progress.md` (`Stage: plan` plus baseline `Checkout-Root:`/`Checkout-Ref:` — root via `cd "$(git rev-parse --show-toplevel)" && pwd -P`, ref via `git symbolic-ref --quiet --short HEAD` else `detached:` + `git rev-parse HEAD`), proceed.
- Existence check runs **before** subtree creation, so a prior run's folder is detected rather than masked by this run's own fresh files.

## Plan stage

1. **Read candidate.** Read `candidate/SKILL.md` in full plus every file under `candidate/references/`. **Tool-permission check:** parse candidate's `allowed-tools`. A candidate running its own `bash <script>` is fine (cleared by the auto-mode classifier; its underlying ops e.g. `git` must be covered by iterate-skill's `allowed-tools` or classifier-cleared). Refuse only a candidate needing a capability iterate-skill genuinely cannot perform or get cleared (e.g. a tool iterate-skill lacks entirely); surface and let the user expand the allowlist or skip.

2. **Extract gated checks inline.** Walk every "must" / "always" / "never" / required field / ordering rule in the candidate. Classify per `references/spec.md` Part 3: gated (objectively verifiable by deterministic assertion) or non-gating (judgment call). Borderline → non-gating.

3. **Dispatch `fixture-assembler` subagent** (always — heavy file writes need context isolation). Wait for return; next step needs the built `fixture/`.

4. **Map scenarios.** Size probe: `candidate/SKILL.md` >300 lines OR `candidate/references/` >5 files → dispatch `scenario-mapper` subagent (per `references/agent-prompts.md`), supplying the gated-checks list (step 2) and built `fixture/`. Otherwise inline scenario mapping following the same subagent template.

5. **Draft test plan inline.** Combine extracted checks, fixture manifest, scenarios. Write to `test-spec.md` draft. Budget estimate:
   - Investigation clears ≈ scenario count + 1 per cut-point scenario (resume continuations) + 1–2 per artifact family the gated checks parse (step 6 canary dispatch) + 1 per additional run-state any clause is exercised in beyond Phase 1 (per step 8: post-apply, post-regen, post-VALIDATION-FAILED each need their own captured artifact bundle if a gated clause reads there) + ~10% for env retries, capped at 30.
   - Iteration clears ≈ 4 × estimated distinct-fix count, capped at 40. Defects plausibly sharing a root cause or scenario count as one fix — same-scenario defects grade together in one retry, so e.g. 7 root-cause-sharing defects may take ~6 clears, not ~28.
   - Extra-state canaries push past the cap → surface the trade-off at the step 8 checkpoint: drop scenarios, demote gated clauses to non-gating, or expand the cap.

6. **Capture real candidate output, then dry-run each verify clause both directions against it.** The orchestrator's deterministic-execution floor: confirms each clause *fires* correctly on real input (step 7's reading review proves each clause *means* the right thing). Keep one inline rule: **every gated check's failure must imply a contract violation** (a clause a contract-compliant candidate could fail is over-specified).

   **(a) Source the positive from real candidate output, never imagination.** Use a prior real candidate run (the live skill's history, a previous iterate-skill run's artifacts) or a **canary run**: dispatch the candidate's smallest artifact-producing unit per artifact family the gated checks parse (Phase 1 alone for a staged-pipeline candidate like deep-simplify; one stateless production for a stateless candidate). Save to `canary-output/<artifact-family>/<state>/` at the work-folder root; the `<state>` segment keeps a family's captures at different run-states (post-Phase-1, post-apply) from clobbering each other (see step 8). Counts as 1–2 Plan-stage clears against the 30-cap (declare in step 5). Canary infeasible (purely interactive, no stateless production) → document the skip in `test-spec.md`'s budget section and rely on step 7 alone.

   **(b) Dry-run both directions.** Positive input must pass; a deliberately-broken input must fail. Same verdict on both — typically silent-pass — is the failure mode this catches (an extractor empty on every input, a `grep` that always matches, an exit-code check that ignores the value). Design the broken input by inverting what the check asserts: change one frontmatter byte (equality check), drop a contractual string (string-presence), add an extraneous file (file-count), write a report missing the required format (report-pattern). Wrong verdict either direction → fix the clause or demote to non-gating. **For a multi-form field (contract permits more than one legal rendering), dry-run the positive against EACH contract-enumerated rendering, not just the one the canary emitted.** Dry-run output isn't retained.

7. **Hand the draft to the review stage — it produces and vets the robustness analysis.** Invoke `/triple-check` on the draft `test-spec.md` (two Claude agents + codex). This stage owns the reading work step 6 skips: per gated check, reviewers decompose conjunctive clauses into sub-assertions, cite the contract anchor for each, construct a contract-compliant counterexample for each, name the run-state each value is valid in, and flag any clause breaking a Verify-clause robustness rule. Include the synthesis in the checkpoint. Adds no `/clears`; ~10–15 min typical, up to 30 when codex's xhigh hits its ceiling. Always run — no skip threshold; if it can't run, the spec is not frozen (surface and stop).

   **Brief reviewers with a check-indexed audit table, not a free-form prompt** — write it to `triple-check-brief.md`, hand that file over. Orchestrator supplies the mechanical left columns; reviewers fill the analysis columns per sub-assertion. One row per gated check:
   - check id / artifact parsed / extractor pattern (orchestrator-supplied)
   - accepted positive shape + run-state captured at (orchestrator-supplied — from step 6's canary, a prior-run artifact with its state noted, or "none — canary infeasible, dry-run skipped" when step 6 documented the skip)
   - scenario states exercised (orchestrator-supplied, per scenarios' `Exercises checks` lists — e.g. S1 post-Phase-1, S2 post-apply)
   - **contract-quote anchor per sub-assertion** (reviewer-produced — decompose the clause first; one entry per sub-assertion citing the marker anchor AND the predicate anchor; a sub-assertion with no contract quote is over-specified and demotes independently)
   - **contract-compliant counterexample per sub-assertion** (reviewer-produced — candidate output that obeys the contract and fails the predicate; if one exists, that sub-assertion is solution-path overfit) **— and for a multi-form field, supply one counterexample per contract-legal rendering the clause must accept.**
   - **run-state validity per sub-assertion** (reviewer-produced — the state(s) the asserted value holds in; a value treated as forever-valid that the contract guarantees only at one state is temporal overfit)
   - negative mutation that would fail the check
   - disposition (reviewer-produced: gated or non-gating, per sub-assertion when conjunctive)

   The "scenario states exercised" vs "positive captured at" delta is the matrix gap reviewers must surface — a clause running in N states with a positive from one has N-1 unguarded states. Reference `references/spec.md` Part 3 § Verify-clause robustness in the prompt.

8. **One user checkpoint, then revalidate.** Show test plan + budget estimate + the review synthesis with the orchestrator's proposed disposition per finding.
   - A reviewer finding that a clause admits a contract-compliant counterexample or breaks a Verify-clause robustness rule is **revision-gating, not advisory**: the orchestrator may not freeze that clause as gated on its own "skip with reason" — revise it, demote it to non-gating, or the user explicitly overrides to keep it gated as-is. Apply revisions in one pass.
   - **Revalidate every clause changed or added here:** re-run step 6's both-directions dry-run against real candidate output (the orchestrator's inline floor); AND re-submit to the review stage for a focused re-check of anchors / counterexamples / run-states whenever the clause's *assertion* changed (not just its disposition) OR it was **promoted from non-gating to gated** here. A promoted clause was never reviewed as gated at step 7 → full per-gated-check analysis (the reviewers' job, here as at step 7), not just a re-check.
   - **Multi-run-state clauses:** every clause running in more than one run-state across its scenarios' `Exercises checks` lists is dry-run against canary output captured at each of those states. A check exercised by S1 post-Phase-1 AND S2 post-apply needs both a post-Phase-1 canary AND a post-apply canary — the post-apply canary either shows the clause's **comparison target** still resolves or shows it diverges (then split the clause per state, or assert a different comparison target captured at the right state, not the live workspace value).
   - Any clause that still silent-passes, false-fails, admits a contract-compliant counterexample, or breaks a Verify-clause robustness rule (rules 1–4 or the headline rule) goes back to revision before freeze — at sub-assertion granularity. On final approval, freeze `test-spec.md`.

9. **Transition.** Set `Stage: investigate`.

## Investigate stage

For each scenario in `test-spec.md`:

1. **Prepare workspace.** Mid-scenario resume (Log has `run <run-id>: cleared-at-<cut-point>` with no subsequent `run <run-id>: … <P>/<T> gated pass` completion line for that exact `<run-id>`) → leave `workspace/` alone; the partial state IS what's being tested. Otherwise (fresh run) → `rm -rf workspace && cp -R fixture workspace`.
2. **Run scenario.** Follow `candidate/SKILL.md` as a file (mechanism: `references/spec.md`). If the scenario's `Cut point` field is not `none`, drive the cut on the first run (append `run <run-id>: cleared-at-<cut-point>` to the Log and queue a `/clear` via the `/clear`-rhythm below; on the next chunk Investigate step 1's mid-scenario-resume branch picks up from the cut, `workspace/` left intact).
3. **Grade inline.** Against the scenario's gated checks (per `references/evaluate-and-fix.md`). Classify each gated-check failure `contract` (candidate's fault — bad outcome despite following the candidate, or candidate silent/ambiguous) or `environment` (transient: flaky subagent / rate-limit / harness; structural: fixture-error / refusal). Err toward `environment` when unclear. Append `contract` defects to `defects.md`; retry `environment` failures per `references/evaluate-and-fix.md` (transient: retry up to twice; structural: pause and surface). Every retry is its own `/clear` and counts against the 30-clear cap. **Before recording any FAIL, re-confirm it on disk with a precise, anchored check (per `references/evaluate-and-fix.md` § Inline grading).**

Exit when all scenarios complete (including env retries and resume continuations) OR 30 clears used (latter means the plan estimate was wrong — surface in report). Set `Stage: iterate`.

## Iterate stage

For each defect in `defects.md` order (defects surfaced by a fix are appended at the end, so the originals are worked first):

1. **Resume-or-snapshot.** Mid-attempt resume (Log has `attempt: defect-NN-attempt-MM cleared-at-<cut-point>` with no subsequent grade line for that exact `defect-NN-attempt-MM`) → prior chunk queued `/clear` mid-retry: skip the snapshot (already exists) AND step 2 (edit already applied); resume the scenario from the cut at step 3, preserving `workspace/`. Otherwise (fresh attempt) → snapshot `cp -R candidate fix-attempts/defect-NN-attempt-MM/`. MM=1 for first attempt, 2 for second.

2. **Apply fix inline.** Quote the defect's `defects.md` row (id, gated check, observation) verbatim. **Spec-drift pre-check:** if the planned edit would remove or rename a section, step name, identifier, or file path that any `test-spec.md` Part 3 `how to verify` clause references, do NOT apply — mark this defect `spec-drift-flagged` in `defects.md` and move to the next defect (skip steps 3–4). Otherwise edit `candidate/SKILL.md` (or whichever file the defect anchors to). No drive-by edits (per `references/evaluate-and-fix.md`).

3. **Retry.** Step 1 took the mid-attempt-resume branch (`workspace/` holds partial state, cut already happened in prior chunk) → resume the scenario from the cut point in this same chunk; do NOT reset `workspace/` and do NOT re-drive the cut (the prior chunk's queue drove it). Otherwise (fresh attempt) reset `workspace/` from `fixture/` and run the scenario fresh — if the scenario's `Cut point` field is not `none`, drive the cut on retry (append `attempt: defect-NN-attempt-MM cleared-at-<cut-point>` to the Log and queue a `/clear` via the `/clear`-rhythm below; on the next chunk Iterate step 1's mid-attempt-resume branch picks up from here). Grade inline against the same gated check.

4. **Classify outcome.** Grade the current defect on its own 2-attempt budget, independent of any new defects the retry surfaced:

   - **Cleared** (the current defect's failing sub-assertion passes on retry — the full id incl. its `(<sub-assertion>)` no longer fails) → mark `fixed`. A *different* sub-assertion of the same check failing on retry is a new defect (below), not a failure to clear this one.
   - **Persists** (the same sub-assertion still fails — same `<check-id>[(<sub-assertion>)]:<scenario-id>:<cut-point>`): first attempt → loop to step 1 for attempt 2; second attempt → mark `stuck`.

   Then handle every **new defect** the retry surfaced (a failure whose structural id differs from the current defect's) by id per the lookup rules below. A defect's own grade does not depend on what it surfaced, and a surfaced defect does not consume the current defect's budget — it just joins the queue.

   **Lookup rules for each new defect's structural id:**

   - **Matches a `fixed` row** → oscillation. Fixing this defect reintroduced one already marked `fixed`; the loop is about to enter an A↔B cycle it can't break mechanically. Mark BOTH the current defect and the matched row `stuck (oscillation)` (per `references/convergence.md`) and surface the pair — this supersedes the current defect's own grade above (a fix that regresses a `fixed` defect isn't an acceptable clear). Do NOT append a new row for this id.
   - **Matches any other existing row** (`stuck` / `stuck (oscillation)` / `spec-drift-flagged` / currently-open) → don't duplicate; log as observed-again.
   - **No match** → append as a new capped defect at the END of `defects.md`. Same 2-attempt budget as any defect, processed when the queue reaches it. The 40-clear cap is the backstop against a long fix-induced chain.

Exit when every defect is terminal (`fixed` / `stuck` / `stuck (oscillation)` / `spec-drift-flagged`) OR 40 iteration clears used. Set `Stage: done`.

## Done stage

Write `report.md`:

- **Per defect:** id, scenario, gated check, defects.md terminal status (`fixed` / `stuck` / `stuck (oscillation)` / `spec-drift-flagged`), attempts used (1 or 2, from the `defect-NN-attempt-MM` Log lines), and the diff of the applied fix(es) if any.
- **If Iteration exited via budget exhaustion:** list defects left open at the cap under the report-only category `unresolved-budget-out`.
- **Summary line:** total scenarios run, defects fixed, defects unresolved.

## Promotion — user step

iterate-skill does not install. Present the converged `candidate/` (its diff against the original) and `report.md`. On the user's explicit approval, **replace** the live skill — never overlay (overlaying leaves orphan files the candidate dropped during iteration).

**Reconcile the checkout first — the one hard checkout gate.** The `rm -rf` below runs against the *current* tree, so a repo moved to a new path or a branch switched since fresh start would delete/replace the wrong skill. Immediately before deleting anything, re-derive the current checkout with the **same commands** the baseline used and compare:

- root `cd "$(git rev-parse --show-toplevel)" && pwd -P` vs `Checkout-Root:`; ref `git symbolic-ref --quiet --short HEAD` (else `detached:` + `git rev-parse HEAD`) vs `Checkout-Ref:`.
- Either differs → **stop and surface**; promote only after the user confirms the switch was intentional and that promoting into the current tree is what they want.
- Baseline `Checkout-*` lines absent (a work folder predating these fields) → **stop and ask for a one-time confirmation** that the current checkout is the original; promote only on explicit confirmation, never by assuming.

Then, on approval — promote from the repo root using **absolute paths**, never cwd-relative or an assumed path (two reasons):

- Bash cwd may have drifted into `workspace/` during scenario runs (cwd persists across calls).
- `<target>`'s live path is the `Target:` line from `progress.md` — not always under `.claude/skills/` (may live deeper, e.g. `test-targets/`).

```
ROOT="$(git rev-parse --show-toplevel)"            # repo root — the gate above already reconciled this against Checkout-Root:
TARGET="$ROOT/<progress.md Target: path>"          # e.g. .claude/skills/iterate-skill/test-targets/mock-basic
rm -rf "$TARGET" && cp -R "$ROOT/<work-folder>/candidate" "$TARGET"
```

- A relative `rm -rf` from a drifted cwd silently no-ops (`-f`); the `cp` then fails loudly — benign (nothing deleted) but skips promotion.

## `/clear`-and-resume rhythm

At each chunk:

1. **Write all state to the work folder.** Rewrite `Stage` + state lines in place — including incrementing by 1 the counter for the pool this `/clear` draws from: `Iteration:` during Iterate, `Investigation:` during Investigate AND during Plan (a Plan-stage `/clear`, e.g. a step 6 canary dispatch, draws from the 30-clear investigation pool and ticks `Investigation:` even though `Stage` is still `plan`). Append Log; update defects.md status rows. **If the chunk interrupts a scenario mid-run** (resume-shaped scenario reached its cut point and the next chunk resumes from that cut, not restart), append the mid-cut marker to the Log BEFORE writing `next-prompt.txt`. Marker depends on stage: Investigate uses `run <run-id>: cleared-at-<cut-point>` (read by Investigate step 1); Iterate uses `attempt: defect-NN-attempt-MM cleared-at-<cut-point>` (read by Iterate step 1's mid-attempt-resume branch — MM required to disambiguate retry attempts).
2. **Output a 2-line chunk summary to stdout:**
   ```
   Chunk: <what happened — N scenarios run, M new defects, fix attempted on defect-K, ...>
   Position: stage <name>, investigation <X>/30, iteration <Y>/40.
   ```
3. **Write `next-prompt.txt`** as one line — `Read` it first if it exists from a prior chunk (else `Write` fails silently and the auto-clear hook never fires). Format: `[iterate-skill-resume] Resume iterate-skill for target <target>. Work folder iterate-skill-<target>.local/ — read progress.md and continue from the recorded position. # ts:<ISO-datetime>`
4. **End turn** with: `Auto-clear queued; if no /clear within ~25s the hook is likely not installed — /clear manually and paste <work-folder>/next-prompt.txt.`

- `PostToolUse` hook fires `auto-clear-hook.sh` → `zellij-clear-resume.sh` after the `next-prompt.txt` write. Orchestrator never calls the helper directly; writing the file IS the trigger.
- `$ZELLIJ_PANE_ID` not set → surface at run start so the user knows clears must be manual.

## Context discipline

- **Target ≤200K per `/clear`.** Anchor on 200K even on 1M-context models.
- **Read before Write/Edit on a fresh post-`/clear` session.** Any pre-existing work-folder file (`progress.md`, `next-prompt.txt`, `defects.md`, `report.md`, `fix-attempts/…`) needs a `Read` before its first mutation in the new session.

## User involvement

- **In:** approve the generated `test-spec.md` + budget estimate at the Plan-stage checkpoint.
- **During:** the loop runs without supervision; the zellij helper drives `/clear` boundaries.
- **Out:** review the converged candidate's diff + `report.md`, approve promotion to the live skill.

## References

- `references/spec.md` — scenario format, faithful-git-repo fixture, scenario-as-file mechanism, gated-check format.
- `references/evaluate-and-fix.md` — inline grading rules (mechanical observables only), inline fixer constraints (quote defect, no drive-by edits, smallest fix).
- `references/convergence.md` — defect identity, termination, stuck detection (including oscillation rules).
- `references/agent-prompts.md` — `fixture-assembler` prompt (always dispatched), `scenario-mapper` prompt (conditional on size probe).
