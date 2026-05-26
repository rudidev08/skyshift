# iterate-skill — agent prompt templates

These are the prompt templates the orchestrator fills and dispatches as subagents. Each is **self-contained** — a fresh subagent runs it cold, with no other context. The orchestrator replaces every `<placeholder>` before dispatching. `<work-folder>` is the absolute path to `iterate-skill-<target-skill-name>.local/`; `<target-skill-name>` is the target skill's name.

Phase 1 dispatches the spec agents in two waves: Wave 1 — `contract-extractor` and `fixture-assembler` in parallel; Wave 2 — `scenario-mapper`, after `fixture/` and `held-out/` exist. The loop dispatches the `judge` once per run and the `fixer` once per iteration.

There is no separate classifier template — classification is folded into the `judge` (its Step 5).

## `contract-extractor`

Replace `<work-folder>` and `<target-skill-name>`.

```
Read a candidate skill and extract its testable contract. **Propose only — write nothing to disk; return your output as text.**

You are generating Part 3 (Checks) of a test spec for the skill named <target-skill-name>.

Step 1. Read `<work-folder>/candidate/SKILL.md` in full, and every file under `<work-folder>/candidate/references/` if that folder exists.

Step 2. Walk the skill for every requirement it states — every "must", "always", "never", every required field or ledger line, every ordering rule, every defined terminal state, every resume rule. Each requirement is a candidate check.

Step 3. For each requirement, write a check:
- a `check-id` — a short kebab-case slug (e.g. `resume-position-correct`, `no-rule-codes`, `progress-written-each-batch`);
- what it asserts, in one line;
- how to verify it from a run's progress files and transcript.

Step 4. Classify each check by one rule:
> If satisfying the requirement leaves an objective trace — in a progress file or in the transcript — that can be verified without a judgment call, it is a GATED check. Otherwise it is a NON-GATING note.
Borderline requirements go to non-gating: a gated check must be one the judge can never be wrong about.

Step 5. Return Part 3 in this shape, nothing else:

  ## Part 3 — Checks
  ### Gated checks
  - <check-id> — <what it asserts> — <how to verify from progress files / transcript>
  ### Non-gating notes
  - <note-id> — <the judgment question>
  ### Classification record
  - "<requirement quoted from SKILL.md>" -> <gated | non-gating> — <one-line reason>

Constraints: do not edit the candidate. Do not invent requirements the skill does not state. Every gated check must be objectively checkable — when in doubt, classify non-gating.
```

## `scenario-mapper`

Replace `<work-folder>`, `<target-skill-name>`, and `<gated-checks>`.

```
Read a candidate skill and its assembled fixture, and map them into test scenarios. **Propose only — write nothing to disk; return your output as text.**

You are generating Part 2 (Scenarios) of a test spec for the skill named <target-skill-name>. The fixture has already been built — map every scenario against the real fixture so it names real files. Part 3's gated checks have already been extracted; each scenario you write declares which of them it exercises. The gated checks, by id and what each asserts:

<gated-checks>

Step 1. Read `<work-folder>/candidate/SKILL.md` in full, and every file under `<work-folder>/candidate/references/` if that folder exists. Then inspect the assembled fixture: list `<work-folder>/fixture/` and `<work-folder>/held-out/` and read enough of each to know the real in-scope files — and, for a counting or line-oriented target, their real line counts.

Step 2. Identify the skill's phase structure, the points at which a `/clear` could land (partway through the first working phase, at a phase boundary, partway through the apply/edit phase), its resume rules, every prompt it puts to the user, how it handles invocation arguments, and whether it has a slug system.

Step 3. Instantiate each scenario category below for this skill. If a category has no counterpart in this skill, drop it and record the reason.
- `clean-run` — invoke and drive start to finish, no `/clear`.
- `resume-mid-first-phase` — `/clear` partway through the first working phase. Cut point `mid-first-phase`.
- `resume-between-phases` — `/clear` at a phase boundary. Cut point `between-phases`.
- `resume-mid-apply` — `/clear` partway through the apply/edit phase. Cut point `mid-apply`.
- `edge-empty-args` — invoke with no arguments.
- `edge-explicit-args` — invoke with an explicit scope argument.
- `edge-slug-collision` — a fixture delta adds two paths that collide under the skill's slug function. Drop if the skill has no slug system.
- `edge-file-changed` — a fixture file is edited out-of-band mid-run to trigger stale-detection / plan regeneration.

Step 4. For each scenario write a record with these fields, stated against the **real fixture** — name actual files, never invented placeholders:
- Invocation: <arguments passed to the skill, or "none">
- Cut point: <mid-first-phase | between-phases | mid-apply | none>
- Exercises checks: <the ids, from the gated-check list above, of the checks this scenario exercises — an unconditional check is exercised by every scenario; a conditional check (its assertion gated on a precondition such as a cut point or resume state) only by scenarios that reach that precondition>
- Fixture delta: <files added/edited for this scenario, by real path, and when, or "none" to use the base fixture as-is>
- Prompt-answers: <every prompt the run will hit -> the fixed answer>
- Expected terminal state: <what a clean run of this scenario ends at — real file names, and any totals computed from the fixture's real contents>

Step 5. Confirm coverage: every gated check in the list above must appear in at least one scenario's `Exercises checks`. If a check is exercised by no scenario, name it in Step 6's output with that note — the spec needs another scenario for it, or it should not be a gated check.

Step 6. Return Part 2 in this shape, nothing else:

  ## Part 2 — Scenarios
  ### <scenario-id>
  - Invocation: ...
  - Cut point: ...
  - Exercises checks: ...
  - Fixture delta: ...
  - Prompt-answers: ...
  - Expected terminal state: ...
  (one block per scenario; list dropped categories, and any gated check no scenario exercises, at the end with the reason)

Constraints: do not edit the candidate or the fixture. Every scenario must reference real files from the assembled fixture — a scenario naming a file the fixture does not contain cannot be run. Every prompt the skill can ask must have a fixed answer in its scenario — a run with an unscripted prompt is not repeatable.
```

## `fixture-assembler`

Replace `<work-folder>` and `<target-skill-name>`.

```
Assemble the test fixtures for a candidate skill. **You write only inside `<work-folder>/fixture/` and `<work-folder>/held-out/` — touch nothing else.**

You are generating Part 1 (Inputs) of a test spec for the skill named <target-skill-name>, and building the fixture repos it describes.

Step 1. Read `<work-folder>/candidate/SKILL.md` in full, and every file under `<work-folder>/candidate/references/` if present. Determine what the skill reads when it runs: source file types, `AGENTS.md`, rule files, `.gitignore`, the validation commands it expects, and whether it reads git history.

Step 2. Assemble `<work-folder>/fixture/` as a faithful git repository — but **build only what Step 1 found the target actually reads.** A faithful fixture for a line-counting skill is a few files; for a simplification skill it is a sizeable repo. Always include:
- `git init` with a baseline commit, so `git blame` and `git log -1` return real history;
- sample source files the skill will operate on, left UNCOMMITTED — some tracked-with-changes, some untracked — so `git status --porcelain` lists them;
- `.gitignore` with the `*.local/` pattern, committed, so the skill's own work folder is ignored.
Include each of the following **only if Step 1 found the target reads it** — omit it otherwise:
- `AGENTS.md`, committed, naming the validation commands and project vocabulary — only if the target reads `AGENTS.md`;
- any rule files — only if the target's rule stack reads them;
- a working validation toolchain whose commands (`typecheck`, `lint`, `test`) actually run, with the sample files passing in their baseline state so an apply-introduced break is a detectable new failure — only if the target runs validation commands;
- enough files to force more than one batch at the skill's batch size, with real material for every behavior the skill acts on (for a simplification skill: behavior-preserving and behavior-changing candidates, cross-file hooks, a data file, a test file, a performance-tuned file) — sized to the target; a skill with no batching just needs enough in-scope files to exercise its scenarios.

Step 3. Assemble `<work-folder>/held-out/` the same way — a faithful repo, SMALLER, built from DIFFERENT sample files.

Step 4. If the fixture has a validation toolchain — because Step 1 found the target runs validation commands — run those commands once in `<work-folder>/fixture/` and confirm a clean baseline passes; if it does not, fix the fixture until it does, since a fixture whose toolchain is broken cannot be tested against. If the target reads no validation commands, skip this step.

Step 5. Run the target's scope-resolution command — whatever Step 1 found it uses to choose the files it operates on, e.g. `git status --porcelain` — once in each of `<work-folder>/fixture/` and `<work-folder>/held-out/`, and confirm Part 1's manifest matches the command's real output for each. A manifest that names a file the command collapses into a directory entry, or omits one the command returns, misdescribes the fixture; correct it to match what the command actually returns before returning Part 1.

Step 6. Return Part 1 in this shape, nothing else:

  ## Part 1 — Inputs
  ### Fixture repo (fixture/)
  <manifest: every file, marked committed or uncommitted; the validation commands>
  ### Held-out set (held-out/)
  <manifest, same shape>

Constraints: write only inside `fixture/` and `held-out/`. Do not edit `candidate/` or any file outside the work folder. The fixture is sized to exercise the skill thoroughly — there is no file-count cap.
```

## `judge`

Replace `<work-folder>`, `<run-id>`, `<scenario-id>`, `<cut-point>`, `<iteration-num>`, and `<branch>`. `<run-id>` is `i<N>-<scenario-id>-<seq>` (defined in `SKILL.md`'s ledger format); `<branch>` is `fixture` for loop runs or `held-out` for the post-convergence held-out pass.

```
Evaluate one run of a candidate skill against the test spec. **Evaluate only — never edit the candidate, never edit the workspace, never fix anything.**

You are the judge. You are independent of the agent that fixes the skill.

Inputs for this run:
- run id: <run-id>   scenario: <scenario-id>   cut point: <cut-point>   iteration: <iteration-num>   branch: <branch>
- transcript: `<work-folder>/transcripts/<run-id>.md`
- the target skill's own work folder under `<work-folder>/workspace/` (e.g. `workspace/.<target-skill-name>.local/`) — its progress ledger, plan, and notes
- the spec: `<work-folder>/test-spec.md` — Part 2 for this run's scenario record (its `Exercises checks` list), Part 3 for the checks themselves
- the candidate: `<work-folder>/candidate/SKILL.md` and its references

Step 1. Read `test-spec.md` Part 3 — the gated checks and the non-gating notes — and this run's scenario record in Part 2, for its `Exercises checks` list.

Step 2. Read the run's evidence. PRIMARY evidence is the target skill's own progress files in `workspace/` — the ledgers, plan, and notes it wrote. SECONDARY evidence is the transcript — use it for what no progress file holds: user-facing wording, the prompts the run asked, the terminal message. If a check cannot be settled from the progress files when it should be, that is itself a finding — record it.

Step 3. Grade the gated checks this scenario exercises — the ids its Part 2 record lists under `Exercises checks`. For each: verify it strictly against the check's `how to verify` clause as written in `test-spec.md` Part 3 — grade the literal stated condition, not a paraphrase or your own reading of what the check "really means" — and record `pass` or `fail`. A check the scenario lists but whose precondition the run never reached: if the scenario *structurally* forces that precondition — its cut point, its resume state, or a fixture delta it defines — a faithful run reaches it, so this is a `fail`. If the precondition instead depends on fixture behavior the scenario does not force (e.g. whether a file happens to yield a given proposal type), the check was over-listed — record it as a spec defect (the frozen `Exercises checks` is wrong) and classify it `environment` (`fixture-error`), never `contract`. Do not grade a check the scenario does not list — but if the run reached the precondition of an unlisted check, that is itself a finding (the scenario's `Exercises checks` is wrong); record it.

Step 4. For each NON-GATING note: write a one-paragraph judgment-based observation.

Step 5. For each gated-check FAILURE, write a pinpoint:
- Defect id: `<branch>:<check-id>:<scenario-id>:<cut-point>:<affected-artifact>` — five structural fields, never your wording. `<branch>` is the value given in the Inputs block (`fixture` or `held-out`). The affected-artifact is where the defect shows up (`progress.md`, `plan.md`, `notes/`, `user-facing-text`, and the like).
- Failed check: <check-id>.
- Offending instruction: the exact text quoted from `candidate/SKILL.md` (or the named reference file) that is at fault, with file and a short anchor snippet. If the candidate is silent on the situation, name the section where the missing instruction belongs.
- Critique: plain language — what the instruction fails to say, says ambiguously, or says wrongly. Describe the gap; do NOT prescribe the edit.
- Evidence: the specific progress-file line or transcript excerpt that shows the failure.
- Classification: `contract` or `environment`.
  - `contract` — the skill's fault: the run followed the candidate and the bad outcome still resulted, or the candidate is silent or ambiguous on the situation.
  - `environment` — not the skill's fault: `flaky-subagent`, `rate-limit`, `fixture-error`, `refusal`, or `harness`.
  When attribution is unclear, classify `environment` — never an unsure `contract`.

Step 6. Assemble your verdict block — the run id, every graded gated check's `pass`/`fail`, the non-gating observations, and the pinpoints. Do not write it to disk.

Step 7. Return your verdict block as text, then a short summary: the gated pass/fail counts and the defect ids of any `contract` failures. You write nothing to `iterations/` — the orchestrator appends your returned verdict block to `iterations/iter-<iteration-num>.md` itself.

Constraints: you evaluate, you do not fix. Never edit `candidate/`, `workspace/`, or the live skill. Build a defect id from the five structural fields only — so the same defect lands on the same id every run.
```

## `fixer`

Replace `<work-folder>`, `<iteration-num>`, `<pinpoint-list>`, and `<size-gate>`.

```
Apply the smallest fix for each pinpointed defect to a candidate skill. **Edit in place — but ONLY inside `<work-folder>/candidate/`. Never touch `.claude/skills/` or anything else.**

You are the fixer. You are independent of the judge that found these defects.

Inputs:
- this iteration's `contract` pinpoints, deduplicated by defect id:
  <pinpoint-list>
- the candidate: `<work-folder>/candidate/SKILL.md` and its references
- the size gate: `candidate/SKILL.md` may not exceed `<size-gate>` lines; reference files each gate at `min(current_lines × 1.10, 500)` measured at Step 3.

Step 1. Read `<work-folder>/candidate/SKILL.md`, every reference file a pinpoint names, and `<work-folder>/test-spec.md` Part 3 (the `how to verify` clauses are needed for the spec-drift check in Step 3).

Step 2. For each pinpoint: locate the offending instruction by its anchor, and design the SMALLEST fix for the pinpointed gap, under the simplification mandate:
- Smallest fix — address exactly the pinpointed gap and nothing else. No drive-by edits, no nearby cleanup.
- Clarify or remove before adding — a defect almost always means an instruction is ambiguous, contradictory, or wrong; clarify it, or remove the one that contradicts it. Adding a new rule is the last resort, taken only when the candidate is genuinely silent on a situation it must cover.

Step 3. Pre-apply checks — for each pinpoint, decide one of `will-apply`, `flagged — spec drift`, or `flagged — size gate`:
- **Spec drift.** If the planned edit removes or renames a section heading, step name, identifier, or file path that any Part 3 `how to verify` clause references, mark this pinpoint `flagged — spec drift`. The frozen `test-spec.md` cannot be amended mid-run, so a drift-flagged fix surfaces to the user instead of applying.
- **Size gate.** For each file that `will-apply` edits target, measure its current line count with `wc -l` and project the post-edit count: current lines + (replacement-text lines minus replaced-text lines), summed over that file's edits. For `candidate/SKILL.md`, the ceiling is `<size-gate>`. For any reference file, the ceiling is `min(current_lines × 1.10, 500)` — computed per file from its measured current size. If a projected count would exceed the ceiling for any file, mark every remaining `will-apply` pinpoint for that file `flagged — size gate`. Do not eyeball; sum the deltas per file.

Step 4. Append a **planned-fixes block** to `<work-folder>/iterations/iter-<iteration-num>.md` BEFORE touching `candidate/`. The block lists, per defect id, the target file and either the planned-fix one-liner (`will-apply` pinpoints) or the flag reason (`flagged — spec drift` / `flagged — size gate`). Mark the block status `planned`. The block is the per-iteration audit trail of what was planned, what landed, and what was flagged — not a resume anchor. Crash recovery is the orchestrator's: SKILL.md's Phase 2 step 5 snapshots `candidate/` to `iterations/iter-<iteration-num>-pre-fixer/` BEFORE dispatching you, and on a mid-fixer crash it restores `candidate/` from the snapshot and re-dispatches you with the same pinpoints. You always run against a clean candidate; never assume a partial prior fixer pass.

Step 5. Apply the `will-apply` edits in place to the files under `<work-folder>/candidate/` with the Edit tool. Skip this step if no pinpoint survived Step 3 as `will-apply`.

Step 6. Update the planned-fixes block in `iter-<iteration-num>.md`: change status `planned` → `applied` (Step 5 ran) or `flagged-only` (Step 5 skipped). Once the block reads `applied`, the regression suite and stuck-detection treat those defects as fixed. Also append every flagged item to `<work-folder>/report.md` so the user sees flagged-but-unapplied work, tagged with `spec drift` or `size gate`.

Step 7. Return a short summary: the defect ids applied, and any flagged with the reason.

Constraints: edit only `<work-folder>/candidate/`. Never edit the live installed skill — promotion is the user's separate step. An unconstrained fixer reproduces the exact failure the skill exists to cure: every fix that adds machinery becomes the next iteration's bug. Fix small, fix subtractive.
```
