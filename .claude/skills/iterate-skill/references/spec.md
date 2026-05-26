# iterate-skill — the test spec

When iterate-skill is pointed at a target skill, its first phase generates a **test spec**: the fixed definition of what the target is run on, how it is run, and what counts as a defect. The spec is generated once, approved by the user once, then frozen to `test-spec.md` in the work folder and never regenerated for that run. Every later step — every run, every judge verdict, every convergence decision — is measured against the frozen spec.

This reference covers spec generation and the spec format. The loop that consumes the spec is in `references/evaluate-and-fix.md` (judge, classifier, fixer) and `references/convergence.md` (defect identity, regression suite, termination).

## Generating the spec — three agents, two waves

At run start (Phase 1), after copying the target skill folder to `candidate/`, the orchestrator dispatches three agents in **two waves** — the scenario catalog depends on the fixture, so its agent runs second. The orchestrator pins each sub-step's completion to a `Phase-1 substate` marker in `progress.md` (full step list in `SKILL.md`'s Phase 1 section), so a `/clear` mid-Phase-1 resumes from the first incomplete sub-step rather than redoing finished work.

**Wave 1 — `contract-extractor` and `fixture-assembler`, in parallel.** Both read only `candidate/SKILL.md` (and any `candidate/references/*`):

- **`contract-extractor`** — reads every requirement the target `SKILL.md` states ("must", "always", "never", required fields, ordering rules, terminal states) and turns each into a **check**, classified gated or non-gating (Part 3). Produces the Checks list.
- **`fixture-assembler`** — reads what the target skill reads and **assembles `fixture/` and `held-out/`** on disk as faithful git repos, sized to what that target actually reads (Part 1). Produces the Inputs manifest.

**Wave 2 — `scenario-mapper`, after Wave 1.** It reads `candidate/SKILL.md`, the assembled `fixture/`, and the gated checks `contract-extractor` produced for Part 3, and instantiates the **scenario catalog** (Part 2): a clean run, a crash/resume run at each cut point the phase structure exposes, the edge-input runs. Seeing the real fixture, it names real fixture files, real cut points, and a real expected end state; against the Part 3 list, each scenario declares which gated checks it exercises. Produces the Scenarios list, each with its fixed prompt-answers and exercised-checks list.

Scenario-mapping is Wave 2 because a scenario's fixture delta and expected terminal state are meaningless without the fixture — a scenario that says "`/clear` after the first file is counted" must name the fixture's actual first file. An agent mapping scenarios blind invents files the fixture does not contain.

The orchestrator never reads the target's source itself — it assembles the three agents' outputs into a single draft `test-spec.md`. The agent prompt templates are in `references/agent-prompts.md`.

A spec agent that fails transiently — an overload, a crash, malformed output — is re-dispatched. Any re-dispatch, whether after a failure or to revise an agent's output, must re-supply that agent's **full original filled prompt**: the templates are self-contained, so a fresh agent started from a thinned prompt silently loses inputs — the `scenario-mapper`'s gated-check list, for one — and produces output that no longer matches the other agents'.

## The one approval checkpoint

The draft `test-spec.md` — whose Part 1 manifests the assembled `fixture/` — is shown to the user. This is the **only** approval gate before the loop. If the `scenario-mapper` flagged any gated check as exercised by no scenario, the orchestrator lists each as an explicit open item in the draft — the checkpoint must resolve it by the adjustments named next (add a scenario, or move the check to non-gating); a draft with an unresolved uncovered gated check is not frozen. The user approves it as-is or asks for adjustments (more or fewer sample files, an added scenario, a check moved between buckets). Adjustments are applied in one revision pass, including any re-assembly of `fixture/` an input change requires; then `test-spec.md` is **frozen**: written to the work folder, recorded in `progress.md`, never regenerated for the rest of the run. A run that needs a materially different spec is a new run — reset the work folder.

Freezing matters: the loop measures convergence against a fixed target. A spec that drifted mid-run would make "the defect rate fell" meaningless.

The freeze is enforced both ways. The orchestrator never regenerates the spec mid-run; the fixer enforces the inverse — when a planned edit would remove or rename a section, step, or identifier any Part 3 `how to verify` clause references, the fixer marks that pinpoint `flagged — spec drift` and surfaces it to the user instead of applying (full mechanics in `references/agent-prompts.md`'s fixer Step 3). The user resolves a spec-drift flag by reverting the fix, resetting the run with a corrected spec, or accepting the drift.

## The frozen spec — `test-spec.md`

```
# Test spec — <target-skill-name>
Frozen: <date>.  Target: <path to the live target skill>.
Run environment (model, CLI version) recorded in progress.md.

## Part 1 — Inputs
### Fixture repo (fixture/)
<manifest: every file, marked committed or uncommitted; the validation commands>
### Held-out set (held-out/)
<manifest, same shape>

## Part 2 — Scenarios
### <scenario-id>
- Invocation: <arguments passed to the target skill, or "none">
- Cut point: <mid-first-phase | between-phases | mid-apply | none>
- Exercises checks: <Part 3 gated check ids this scenario exercises>
- Fixture delta: <files added/edited for this scenario, and when, or "none">
- Prompt-answers: <each prompt the run will hit -> the fixed answer>
- Expected terminal state: <what a clean run ends at>
(one block per scenario)

## Part 3 — Checks
### Gated checks
- <check-id> — <what it asserts> — <how to verify it from progress files / transcript>
(one line per gated check)
### Non-gating notes
- <note-id> — <the judgment question>
(one line per non-gating note)
### Classification record
- "<requirement quoted from SKILL.md>" -> <gated | non-gating> — <one-line reason>
```

## Part 1 — Inputs

A target skill often reads a whole **repository**, not just loose files: `git status` for scope, `git blame`/`git log` for history, `.gitignore` for its work folder, `AGENTS.md` for conventions and validation commands, rule files for the rule stack. A loose folder of source files would exercise behavior the real skill never runs — so the fixture is a **faithful temporary git repo**.

### The fixture repo

`fixture/` is assembled by the `fixture-assembler` as a self-contained git repository. When a run executes, the target skill treats its working copy of `fixture/` as its repo root. Faithfulness requirements:

- **A real git repo.** `git init`, with a baseline commit, so `git blame` and `git log -1` return real history.
- **Sample source files left uncommitted.** The files the target skill operates on are present in the working tree but not committed, so `git status --porcelain` lists them — the default scope for a skill that operates on uncommitted changes. Some live tracked-with-changes, some untracked, to cover both.
- **`.gitignore` with the `*.local/` pattern**, committed — so the target skill's own work folder is ignored inside the fixture, exactly as in a real repo.
- **`AGENTS.md`**, committed — the conventions file the target skill reads, naming the validation commands and project vocabulary.
- **Any rule files** the target's rule stack expects, committed. One scenario may deliberately omit them to exercise the target's behavior when those files are absent — see Part 2.
- **A working validation toolchain.** The commands `AGENTS.md` names (`typecheck`, `lint`, `test`) must actually run — real enough that a genuine break fails and a clean tree passes. A skill that validates after every apply batch will mis-report against a fixture whose `npm run typecheck` is a stub.
- **Sized to exercise the skill, no cap.** Enough files to force multi-batch dispatch (more than one batch at the target's batch size), with real instances of every behavior the checks probe. As thorough as the target needs; the design sets no file-count ceiling.

`fixture/` is **pristine after freeze** — never run against directly. Each run gets a fresh copy in `workspace/` (see "Running a scenario").

### The held-out set

`held-out/` is a second faithful repo — same shape, **smaller**, assembled from different sample files. The loop never runs against it: not for defect-finding, not for regression replay. It is run exactly once, after the loop reports convergence, as the overfitting check (see `references/convergence.md`). Keeping it untouched by the loop is what makes it a real held-out test.

## Part 2 — Scenarios

A scenario is one scripted way to run the target skill. The `scenario-mapper` instantiates each category below that applies to the target; a category with no counterpart in the target skill is dropped, with the reason recorded in `test-spec.md`. Each scenario record carries: a stable **scenario id**, the **invocation** (arguments passed), the **cut point** (where `/clear` happens, or `none`), the **gated checks it exercises** (the Part 3 checks whose precondition this scenario reaches — the judge grades a scenario only on these), any **fixture delta** (files added or edited for this scenario, at setup or mid-run), the **fixed prompt-answers**, and the **expected terminal state**. Every gated check must be exercised by at least one scenario — a check no scenario reaches cannot gate convergence, so the `scenario-mapper` flags any it finds uncovered.

The categories:

- **`clean-run`** — invoke the target, drive it start to finish, no `/clear`. The baseline: with no crash, every gated check should pass.
- **`resume-mid-first-phase`** — `/clear` partway through the target's first working phase, then resume. Cut point `mid-first-phase`.
- **`resume-between-phases`** — `/clear` exactly at a phase boundary, then resume. Cut point `between-phases`.
- **`resume-mid-apply`** — `/clear` partway through the target's apply/edit phase, then resume. Cut point `mid-apply`. The highest-stakes resume — partially-applied edits plus a partially-written ledger.
- **`edge-empty-args`** — invoke with no arguments, exercising the target's default-scope path.
- **`edge-explicit-args`** — invoke with an explicit scope argument (a folder or file subset of the fixture).
- **`edge-slug-collision`** — the fixture delta adds two file paths that collide under the target's slug function (path with `/`→`-` and `.`→`-`); the target must stop and report the collision rather than overwrite a note. Dropped for a target with no slug system.
- **`edge-file-changed`** — a fixture file is edited out-of-band at a named point mid-run (e.g. after the first phase completes, before apply), triggering the target's stale-detection and plan-regeneration path. The record names the file, the edit, and the timing.

**Fixed prompt-answers.** The target skills pause for user input — scope confirmation, plan review, resume-vs-reset, per-item judgment calls. For a run to be repeatable, every answer the user gives must be scripted in the scenario record. Whoever drives the run reads the answers off the scenario; they do not improvise. An unanticipated prompt — the run asked something the script doesn't cover — is itself a finding: it is recorded and surfaced, because a well-specified skill shouldn't ask anything the `scenario-mapper` couldn't predict from its `SKILL.md`.

## Part 3 — Checks

A check is one defect the judge looks for in a run. Checks come in two buckets.

### Gated checks

A gated check is **objectively verifiable** from the run's progress files and transcript — no judgment call. It is true or false by inspection. These are the checks convergence is measured on. Examples (for a multi-phase orchestration target):

- a required ledger field is present and well-formed in `progress.md`;
- after `/clear`+resume, the run continued from the next un-recorded ledger item — not earlier (rework) or later (skipped work);
- no plan item carries two outcome lines for one generation (no duplicated state);
- every `progress.md` line matches a defined ledger shape;
- no rule codes (`M3`, `D.1`, and the like) appear in any user-facing message;
- the slug-collision scenario stopped the run and reported, rather than overwriting a note;
- the run reached a defined terminal state, not a stall;
- a `VALIDATION-FAILED` marker is always cleared, or the run stopped on it.

### Non-gating notes

A non-gating note is a "must" that needs a **judgment call** to evaluate — it cannot be settled by inspecting files. Examples:

- was the run appropriately conservative — did it under-propose, as the skill instructs?
- are the behavior-changing proposals genuinely grounded in the code, not asserted?
- did the apply phase pause at real judgment calls and not at trivial ones?
- beyond the binary "no rule codes" check, is the user-facing prose actually clear?

Non-gating notes are evaluated by the judge and collected into the final report. They are **never gated on** and **never auto-fixed** — reported to the user as observations, for the user to act on or not.

### Classifying every "must"

The `contract-extractor` walks every requirement in the target `SKILL.md` and applies one rule:

> If satisfying the requirement leaves an **objective trace** — in a progress file or in the transcript — that a subagent can verify without a judgment call, it is a **gated check**. Otherwise it is a **non-gating note**.

Borderline requirements go to non-gating: a check that gates convergence must be one the judge can never be wrong about. `test-spec.md` records, per requirement, the bucket and a one-line reason — so the user, at the approval checkpoint, can move any classification they disagree with.

## Running a scenario — the candidate as a file

A run executes the target skill **by following `candidate/SKILL.md` as a file**, not by `/`-invoking the installed skill — which would load `.claude/skills/<target-skill-name>/`, the live copy, not the candidate. Following the file is what puts the candidate copy under test and leaves the installed skill untouched until the user approves promotion.

The run instruction the orchestrator follows:

> Read `candidate/SKILL.md` and follow it exactly as written, as if it had just been loaded as a skill. Resolve every `references/…` and `scripts/…` path it mentions relative to `candidate/`. Treat `workspace/` as the repository it operates on. Take the invocation arguments and the fixed prompt-answers from the scenario record.

The only thing `/`-invocation adds over following the file is the skill system binding the skill's base directory; the run instruction supplies that explicitly — base directory is `candidate/` — so the behavior under test is the same. If a run ever shows the framing itself changed behavior, that is a finding for the report, not something the loop silently absorbs.

**Each run works on a fresh fixture copy.** A run mutates its repo — the target skill writes a work folder and applies edits. Before a **fresh** scenario run the orchestrator resets the workspace: `rm -rf workspace && cp -R fixture workspace` (or from `held-out` for the held-out pass). On resume of the **second half** of a mid-scenario `/clear`, the orchestrator skips the reset — the partial state is what the resume scenario tests (the carve-out is pinned in the Phase 2 loop in `SKILL.md`). `fixture/` and `held-out/` themselves stay pristine.

The run's transcript is captured to `transcripts/<run-id>.md` (`<run-id>` format defined in `SKILL.md`'s ledger format). The orchestrator writes it as a single `Write` call when the scenario reaches its terminal state or the helper queues a mid-run `/clear`: one line per orchestrator step (tool, outcome, target progress-file delta), each prompted target question and the scripted answer, the target skill's progress-file paths under `workspace/.<target-skill-name>.local/` as they stood at scenario end, then a `Terminal: <reached | cleared-at-<cut-point>>` footer. The judge reads this file plus the on-disk progress files.
