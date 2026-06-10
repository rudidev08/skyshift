# iterate-skill — agent prompt templates

Subagent prompts the orchestrator fills and dispatches. Each is **self-contained** — a fresh subagent runs it cold, with no other context. The orchestrator replaces every `<placeholder>` before dispatching. `<work-folder>` is the absolute path to `iterate-skill-<target>.local/`; `<target>` is the target skill's name.

The Plan stage dispatches:

- **`fixture-assembler`** — always. Heavy file writes (building a faithful git repo from scratch); context isolation is the right call regardless of candidate size.
- **`scenario-mapper`** — only when the size probe selects subagent mode (candidate >300 lines OR `candidate/references/` >5 files). Otherwise the orchestrator inlines the same steps.

There are no other subagents — grading and fixing are inline (per `references/evaluate-and-fix.md`). The former `contract-extractor`, `judge`, and `fixer` templates have been removed because their work is now done inline by the orchestrator.

## `fixture-assembler`

Replace `<work-folder>` and `<target>`.

```
Assemble the test fixture for a candidate skill. **You write only inside `<work-folder>/fixture/` — touch nothing else.**

You are generating Part 1 (Inputs) of a test spec for the skill named <target>, and building the fixture repo it describes.

Step 1. Read `<work-folder>/candidate/SKILL.md` in full, and every file under `<work-folder>/candidate/references/` if present. Determine what the skill reads when it runs: source file types, `AGENTS.md`, rule files, `.gitignore`, the validation commands it expects, and whether it reads git history.

Step 2. Assemble `<work-folder>/fixture/` as a faithful git repository — but **build only what Step 1 found the target actually reads.** A faithful fixture for a line-counting skill is a few files; for a simplification skill it is a sizeable repo. Always include:
- `git init` with a baseline commit, so `git blame` and `git log -1` return real history;
- sample source files the skill will operate on, left UNCOMMITTED — some tracked-with-changes, some untracked — so `git status --porcelain` lists them;
- `.gitignore` with the `*.local/` pattern, committed, so the skill's own work folder is ignored.
Include each of the following **only if Step 1 found the target reads it** — omit it otherwise:
- `AGENTS.md`, committed, naming the validation commands and project vocabulary — only if the target reads `AGENTS.md`;
- any rule files — only if the target's rule stack reads them;
- a working validation toolchain whose commands (`typecheck`, `lint`, `test`) actually run, with the sample files passing in their baseline state so an apply-introduced break is a detectable new failure — only if the target runs validation commands;
- enough files to force more than one batch at the skill's batch size, with real material for every behavior the skill acts on (for a simplification skill: behavior-preserving and behavior-changing candidates, cross-file hooks, a data file, a test file, a performance-tuned file) — sized to the target; a skill with no batching just needs enough in-scope files to exercise its scenarios. And any candidate behavior gated on a subagent's discretionary judgment (auto-accept a proposal, escalate to individual triage, drop vs keep) needs fixture input unambiguous enough to **compel** that judgment, not merely permit it — a conservative subagent that declines leaves the path uncovered. Make the change so clearly in-bounds (e.g. a dead, history-less, zero-consumer local helper for an auto-accept-LOCAL path) that a faithful conservative subagent acts every run, or note in Part 1 that the path's coverage depends on subagent judgment and may need a dedicated scenario to force it.

Step 3. If the fixture has a validation toolchain — because Step 1 found the target runs validation commands — run those commands once in `<work-folder>/fixture/` and confirm a clean baseline passes; if it does not, fix the fixture until it does, since a fixture whose toolchain is broken cannot be tested against. If the target reads no validation commands, skip this step.

Step 4. Run the target's scope-resolution command — whatever Step 1 found it uses to choose the files it operates on, e.g. `git status --porcelain` — once in `<work-folder>/fixture/` and confirm Part 1's manifest matches the command's real output. A manifest that names a file the command collapses into a directory entry, or omits one the command returns, misdescribes the fixture; correct it before returning Part 1. Also confirm the working tree holds ONLY your intended in-scope files plus the committed baseline — delete any stray you or the Step-3 validation run left behind (`.DS_Store`, scratch files, a `__pycache__/` or `.pyc`) before recording the manifest. A stray inside `fixture/` rides along in every `cp -R fixture workspace`, shows as untracked in the scenario's `git status`, and distorts the scope the target resolves.

Step 5. Return Part 1 in this shape, nothing else:

  ## Part 1 — Inputs
  ### Fixture repo (fixture/)
  <manifest: every file, marked committed or uncommitted; the validation commands>

Constraints: write only inside `fixture/`. Do not edit `candidate/` or any file outside the work folder. The fixture is sized to exercise the skill thoroughly — there is no file-count cap.
```

## `scenario-mapper`

Replace `<work-folder>`, `<target>`, and `<gated-checks>`. Dispatched only when the size probe selects subagent mode.

```
Read a candidate skill and its assembled fixture, and map them into test scenarios. **Propose only — write nothing to disk; return your output as text.**

You are generating Part 2 (Scenarios) of a test spec for the skill named <target>. The fixture has already been built. The orchestrator has already extracted Part 3's gated checks inline and supplies them here:

<gated-checks>

Step 1. Read `<work-folder>/candidate/SKILL.md` in full, and every file under `<work-folder>/candidate/references/` if present. Then inspect the fixture: list `<work-folder>/fixture/` and read enough of it to know the real in-scope files — and, for a counting or line-oriented target, their real line counts.

Step 2. Identify the skill's phase structure, the points at which a `/clear` could land (partway through the first working phase, at a phase boundary, partway through the apply/edit phase), its resume rules, every prompt it puts to the user, how it handles invocation arguments, and whether it has a slug system. Also classify **statelessness**: the target is stateless if its SKILL.md mentions none of (a `*.local/` work folder, `progress.md`/`plan.md`/ledger, an explicit resume rule, more than one working phase). Otherwise it is stateful. Statelessness changes which resume categories apply in Step 3.

Step 3. Instantiate each scenario category below that applies. If a category has no counterpart in this skill, drop it and record the reason.

Categories:
- `clean-run` — invoke and drive start to finish, no `/clear`.
- `resume-mid-first-phase` — `/clear` partway through the first working phase. Cut point `mid-first-phase`. **Drop for stateless targets** (the cut reduces to "restart cleanly" — tautological, graded identically to `clean-run`).
- `resume-between-phases` — `/clear` at a phase boundary. Cut point `between-phases`. **Drop for stateless targets** (same reason).
- `resume-mid-apply` — `/clear` partway through the apply/edit phase. Cut point `mid-apply`. **For stateless targets, replace with `edge-partial-write-resume`** — the durable Write side-effect is still testable even without a ledger.
- `edge-partial-write-resume` — **stateless targets only**, in place of `resume-mid-apply` (cut point `mid-apply` — the simulated cut stands in for a mid-apply interruption). The candidate completes in one assistant response, so there is no `/clear` boundary between its Write and any post-write Read; the cut is **simulated** — the driver writes a partially-rewritten version of the target file into `workspace/`, `/clear`s, then re-invokes the candidate against the now-partially-rewritten file. On resume the candidate sees an intermediate state on disk that it must converge to a faithful end state (no re-compression of already-compressed content, no contractual-string loss, no duplicated sections, no broken file). The partial-cut content is **pre-computed once during Plan stage and frozen** as `<work-folder>/scenario-cuts/<scenario-id>.md` (work-folder root, not inside `fixture/`); the driver copies it into `workspace/` rather than redrafting per attempt.
- `edge-empty-args` — invoke with no arguments.
- `edge-explicit-args` — invoke with an explicit scope argument.
- `edge-slug-collision` — a fixture delta adds two paths that collide under the skill's slug function. Drop if the skill has no slug system.
- `edge-file-changed` — a fixture file is edited out-of-band mid-run to trigger stale-detection / plan regeneration.

Step 4. **Cap the scenario count at 20.** If the categories above would produce more, prioritize by coverage. Always include: at least one `clean-run`, at least one resume case (`resume-mid-apply` or `edge-partial-write-resume` per statelessness), at least one detached-edge case that exercises a gated check no other scenario covers. Trim extras while preserving full gated-check coverage.

Step 5. For each scenario write a record with these fields, stated against the **real fixture** — name actual files, never invented placeholders:
- Invocation: <arguments passed to the skill, or "none">
- Cut point: <mid-first-phase | between-phases | mid-apply | none>
- Exercises checks: <the ids, from the gated-check list above, of the checks this scenario exercises — an unconditional check is exercised by every scenario; a conditional check (its assertion gated on a precondition such as a cut point or resume state) only by scenarios that reach that precondition>
- Fixture delta: <files added/edited for this scenario, by real path, and when, or "none" to use the base fixture as-is>
- Prompt-answers: <every prompt the run will hit -> the fixed answer>
- Expected terminal state: <what a clean run of this scenario ends at — real file names, and any totals computed from the fixture's real contents>

Step 6. Confirm coverage: every gated check in the list above must appear in at least one scenario's `Exercises checks`. If a check is exercised by no scenario, name it in Step 7's output with that note — the orchestrator will either add a scenario at the approval checkpoint, or move the check to non-gating.

Step 7. Return Part 2 in this shape, nothing else:

  ## Part 2 — Scenarios
  ### <scenario-id>
  - Invocation: ...
  - Cut point: ...
  - Exercises checks: ...
  - Fixture delta: ...
  - Prompt-answers: ...
  - Expected terminal state: ...
  (one block per scenario; up to 20; list any dropped categories and any uncovered gated check at the end with the reason)

Constraints: do not edit the candidate or the fixture. Every scenario must reference real files from the assembled fixture — a scenario naming a file the fixture does not contain cannot be run. Every prompt the skill can ask must have a fixed answer in its scenario — a run with an unscripted prompt is not repeatable. Cap is 20 scenarios.
```
