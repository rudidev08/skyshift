# iterate-skill — the test spec

When iterate-skill is pointed at a target, the Plan stage generates a **test spec**: the fixed definition of what the target is run on, how it is run, and what counts as a defect. Generated once, approved by the user once, then frozen to `test-spec.md` in the work folder. Every later step measures against the frozen spec.

This reference covers spec generation and the spec format. The loop that consumes it is in `references/evaluate-and-fix.md` (grading, classification, fixing) and `references/convergence.md` (defect identity, termination, stuck detection).

## Generating the spec

The Plan stage is small. The orchestrator:

1. **Reads the candidate** (`candidate/SKILL.md` + everything under `candidate/references/`).
2. **Extracts gated checks inline.** Walks every "must"/"always"/"never"/required field/ordering rule and classifies each by the rule in Part 3 below.
3. **Dispatches `fixture-assembler` subagent** (always — heavy file writes need context isolation). Waits for return; the next step needs the built `fixture/`.
4. **Maps scenarios.** Size probe: if `candidate/SKILL.md` >300 lines OR `candidate/references/` has >5 files, dispatches `scenario-mapper` as a subagent (template in `references/agent-prompts.md`), supplying the gated-checks from step 2 and naming the now-built `fixture/`. Otherwise the orchestrator inlines scenario mapping itself, following the same steps as the subagent template.
5. **Estimates the budget.** Rough shape: investigation clears scale with scenario count plus the per-cut-point, canary, and extra-run-state captures (capped at 30); iteration clears ≈ 4 × estimated distinct-fix count — defects sharing a root cause or scenario count as one fix, since same-scenario defects grade together in one retry (capped at 40). The full term-by-term formula lives in SKILL.md Plan stage step 5 — see it there. The hard caps (30 / 40) bind at the stage exits regardless of whether the estimate is right, so it is a planning aid, not a control.
6. **Captures real candidate output and dry-runs each gated check's verify clause both directions against it.** Source the positive from a prior real candidate run or a fresh canary dispatch saved to `canary-output/<artifact-family>/<state>/` at the work-folder root, not inside `fixture/` (the canary runs the candidate's smallest artifact-producing unit per artifact family the gated checks parse, against a throwaway copy of `fixture/` — never `fixture/` itself, which must stay pristine for freeze; counts against the Plan-stage clear budget; skip only when canary is infeasible — never fall back to author-imagined inputs). Then dry-run each clause both directions: the positive passes, a deliberately-broken input fails (same-verdict-on-both = silent-pass = fix or demote). The orchestrator keeps inline only the rule that every gated check's failure must imply a contract violation; the *reading* review of the clauses — anchors, solution-path overfit, run-state validity, conjunctive decomposition — is the step-7 review stage's job, not the orchestrator's. See SKILL.md Plan stage step 6 for the full procedure.
7. **Hands the draft to the review stage, which produces and vets the robustness analysis.** Invokes `/triple-check` on the draft `test-spec.md` for a 3-way consensus review (two Claude agents + codex). Always runs — the reviewers now own the reading work the orchestrator dropped: per gated check they decompose conjunctive clauses into sub-assertions, cite the contract anchor for each, construct a contract-compliant counterexample for each, name the run-state each value is valid in, and flag any clause that breaks a Verify-clause robustness rule; the synthesis also catches contract-coverage gaps (missing scenarios, incomplete contractual-string lists, scenario/check contradictions) a dry-run never could. **Brief reviewers with a check-indexed audit table** — the orchestrator supplies the mechanical left columns (check id / artifact / extractor / accepted positive shape / scenario states exercised) and the reviewers fill the anchor, counterexample, run-state, and disposition columns per sub-assertion. See SKILL.md Plan stage step 7.

## The one approval checkpoint

The draft `test-spec.md`, the budget estimate, and the triple-check synthesis (with the orchestrator's proposed disposition per finding) are shown to the user. **The only approval gate before the loop.** The user approves as-is or asks for adjustments (more or fewer scenarios, a check moved between buckets, different fixture content, triple-check findings to incorporate or override). Adjustments apply in one revision pass — but that pass is not the freeze. Every clause changed or added at the checkpoint is revalidated first (SKILL.md Plan stage step 8): re-run step 6's both-directions dry-run against real candidate output; re-submit to the review stage any clause whose assertion changed or that was promoted non-gating → gated; and dry-run every clause that runs in more than one run-state against canary output captured at each state. A reviewer counterexample/robustness finding is revision-gating, not advisory — the orchestrator can't freeze a flagged clause on its own "skip"; it revises, demotes to non-gating, or the user explicitly overrides. Only then is the spec frozen.

If any gated check has no covering scenario, the draft surfaces it explicitly — the checkpoint must resolve it (add a scenario, or move the check to non-gating). A draft with an unresolved uncovered gated check is not frozen.

Freezing matters: the loop measures defects against a fixed target. A spec that drifted mid-run would make defect counts meaningless. The orchestrator never regenerates the spec mid-run; an inline fixer respects the freeze by refusing any edit that would remove or rename a section, step, identifier, or file path that any Part 3 `how to verify` clause references — such an edit is marked `spec-drift-flagged` for the user, not applied.

## The frozen spec — `test-spec.md`

```
# Test spec — <target>
Frozen: <date>.  Target: <path to live target skill>.
Run environment recorded in progress.md.

## Part 1 — Inputs
### Fixture repo (fixture/)
<manifest: every file marked committed or uncommitted; validation commands>

## Part 2 — Scenarios
### <scenario-id>
- Invocation: <arguments passed to target, or "none">
- Cut point: <mid-first-phase | between-phases | mid-apply | none>
- Exercises checks: <Part 3 gated check ids this scenario exercises>
- Fixture delta: <files added/edited for this scenario, and when, or "none">
- Prompt-answers: <every prompt the run hits → the fixed answer>
- Expected terminal state: <what a clean run of this scenario ends at>
(one block per scenario; paths under fixture/; cap 20)

## Part 3 — Checks
### Gated checks
- <check-id> — <what it asserts> — <how to verify deterministically from progress files / outputs>
### Non-gating notes
- <note-id> — <the judgment question>
```

## Part 1 — Inputs

A target skill often reads a whole **repository**, not loose files: `git status` for scope, `git blame`/`git log` for history, `.gitignore` for its work folder, `AGENTS.md` for conventions and validation commands, rule files for the rule stack. A loose folder of source files would exercise behavior the real skill never runs — so the fixture is a **faithful temporary git repo**.

### The fixture repo

`fixture/` is built by `fixture-assembler` as a self-contained git repo. When a run executes, the target treats its working copy of `fixture/` as its repo root. Faithfulness requirements:

- **A real git repo.** `git init`, with a baseline commit, so `git blame` and `git log -1` return real history.
- **Sample source files left uncommitted.** Files the target operates on are present in the working tree but not committed, so `git status --porcelain` lists them. Some live tracked-with-changes, some untracked.
- **`.gitignore` with the `*.local/` pattern**, committed — so the target's own work folder is ignored.
- **`AGENTS.md`**, committed (only if the target reads it) — naming validation commands and project vocabulary.
- **Any rule files** the target's rule stack expects, committed. One scenario may deliberately omit them to exercise the absent-file path.
- **A working validation toolchain** (only if the target runs validation commands). Commands `AGENTS.md` names (`typecheck`, `lint`, `test`) must actually run — real enough that a genuine break fails and a clean tree passes. A skill that validates after every apply batch will mis-report against a fixture whose `npm run typecheck` is a stub.
- **Sized to exercise the skill, no cap.** Enough files to force multi-batch dispatch (more than one batch at the target's batch size), with real instances of every behavior the checks probe.

`fixture/` is **pristine after freeze**. Each run gets a fresh copy in `workspace/`.

## Part 2 — Scenarios

A scenario is one scripted way to run the target. `scenario-mapper` (subagent or inline) instantiates each category below that applies. A category with no counterpart in the target is dropped, with the reason recorded. **The catalog is capped at 20.** Every gated check must be exercised by at least one scenario.

Each scenario record carries: stable **scenario id**, **invocation** (arguments), **cut point** (`/clear` location, or `none`), **gated checks it exercises**, any **fixture delta**, **fixed prompt-answers**, and **expected terminal state**.

The categories:

- **`clean-run`** — invoke, drive start to finish, no `/clear`. Baseline: with no crash, every gated check should pass.
- **`resume-mid-first-phase`** — `/clear` partway through the target's first working phase, then resume. Cut point `mid-first-phase`.
- **`resume-between-phases`** — `/clear` at a phase boundary, then resume. Cut point `between-phases`.
- **`resume-mid-apply`** — `/clear` partway through the apply/edit phase, then resume. Cut point `mid-apply`. The highest-stakes resume — partially-applied edits plus a partially-written ledger.
- **`edge-empty-args`** — invoke with no arguments.
- **`edge-explicit-args`** — invoke with an explicit scope argument.
- **`edge-slug-collision`** — fixture delta adds two paths colliding under the target's slug function. Dropped if no slug system.
- **`edge-file-changed`** — a fixture file edited out-of-band mid-run, triggering stale-detection.
- **`edge-partial-write-resume`** — used **only for stateless targets, in place of `resume-mid-apply`** (cut point `mid-apply` — the simulated cut stands in for a mid-apply interruption). The candidate completes in one assistant response, so there is no `/clear` boundary between its Write and any post-write Read — those tool calls fire consecutively in the same response. The cut is therefore **simulated**: the orchestrator manually writes a partially-rewritten version of the target file into `workspace/`, then `/clear`s, then re-invokes the candidate against the now-partially-rewritten file. On resume the candidate sees an intermediate state on disk that it must converge to a faithful end state without re-compressing already-compressed content, losing contractual strings, duplicating sections, or producing a broken file. **The partial-cut content is pre-computed once during Plan stage and frozen** at `scenario-cuts/<scenario-id>.md` at the work-folder root (not inside `fixture/`). Pre-computation keeps the cut byte-identical across attempts within the run; the orchestrator must not redraft the cut between retries.

**Reconstructing a stateful drive-to-cut.** Reaching a stateful scenario's cut (`mid-first-phase` / `between-phases` / `mid-apply`) normally means driving the candidate for real up to the `/clear`. When that drive requires an expensive or flaky real subagent run — e.g. an agent that returns, then loses its report at the `/clear`, which is the very state under test — the orchestrator MAY instead reconstruct the setup-to-cut state deterministically by hand, but ONLY if the reconstruction is verified faithful to a real partial run: the same green baseline plus the exact git/workspace state (branch, commits, staged and untracked files) the real cut would leave. The behavior **under test** — the post-cut continuation the resume scenario grades — must always run with real agents; reconstructing the part under test invalidates the result. Conversely, don't spend real agent runs purely to produce throwaway pre-cut setup.

**Resume scenarios on stateless targets.** A target is **stateless** if its `SKILL.md` mentions none of (a `*.local/` work folder, `progress.md`/`plan.md`/ledger, an explicit resume rule, more than one working phase). For such a target, `scenario-mapper` drops `resume-mid-first-phase` and `resume-between-phases` (their cuts reduce to "restart cleanly" — tautological, graded identically to `clean-run`) and replaces `resume-mid-apply` with `edge-partial-write-resume`. Detection is once, at spec generation.

**Fixed prompt-answers.** The target may pause for user input — scope confirmation, plan review, resume-vs-reset, judgment calls. For repeatability, every answer is scripted in the scenario record. Whoever drives the run reads answers off the scenario; they do not improvise. An unanticipated prompt is itself a finding.

## Part 3 — Checks

A check is one defect the orchestrator looks for in a run. Two buckets.

### Gated checks

**Deterministic assertions over named artifacts** — no judgment call. True or false by inspection. Each gated check's `how to verify` clause must reduce to one of:

- "Line X of file Y matches pattern P," or
- "Subagent return contains / lacks Z," or
- "File counts at runtime path Q satisfies inequality R," or
- An equivalent objective predicate (last-line-wins state, one verdict per run, no skipped resume item, consistent ledgers).

**Carve-out: orchestrator tool-call ordering is not gated.** In the inline-run model the orchestrator both drives the candidate and grades the run; there is no durable transcript of which tools fired in what order, and post-`/clear` the conversation log is gone. A check that asks "did the candidate execute tool X after tool Y" is orchestrator self-attestation, not a deterministic assertion over a named artifact. Such checks belong in non-gating. If the candidate's contract genuinely requires a specific call ordering to be verifiable, the candidate itself must write a durable artifact — a progress-file line, a sidecar log entry — that a gated check reads.

**Verify-clause robustness.** Verify clauses parse candidate output and assert structural properties of it. A clause that bakes in an incidental layout, a specific solution path, or a temporally-bounded value treated as forever-valid will false-fail on contract-compliant output that looks or behaves differently. The step-7 review stage applies the rules below to catch this overfit; the step-6 dry-run — now sourced from real canary output, not imagination — catches the complementary silent-pass failure where a clause never fires on any input.

**Headline rule.** Every assertion a gated verify clause makes must imply a contract violation when it fails. A predicate whose failure could be triggered by contract-compliant candidate output — output the candidate's `SKILL.md` doesn't promise will look or behave the specific way the predicate assumes — is over-specified and either rewrites to the actual contractual rule or demotes to non-gating. The five rules below enforce specific facets of it: rule 1 catches layout/syntax-level violations, rule 2 catches solution-path violations, rule 3 catches extractor inconsistencies, rule 4 catches temporal violations, rule 5 catches multi-form-field violations.

- **Anchor only on candidate-contract-guaranteed markers.** Split candidate output on what the candidate's prompt template or `SKILL.md` explicitly produces — named headings (with the heading level the contract names), named field labels in stable order, ledger-line prefixes. Never on incidental whitespace. **Forbidden anchors:** blank-line splits (`^$`, `\n\n+`), horizontal-rule splits (`^---$`), whitespace-only patterns, "as many `#` as the synthesizer chose" without a fixed heading level the contract names. If the candidate's contract does not produce a stable structural marker for the substructure you want to assert about, the requirement belongs in non-gating, not gated. **Conjunctive clauses split into sub-assertions before this rule applies.** A verify clause that asserts multiple independent predicates (joined with `AND` / `&&` / comma-separated `sys.exit` conditions / multiple `if not` checks) decomposes into its component sub-assertions; each sub-assertion needs its own contract anchor — both for the marker it parses and for the predicate it asserts. A sub-assertion without an anchor demotes independently, even when other sub-assertions in the same clause are anchored: a half-anchored conjunction is half-anchored, not anchored.
- **Rule, not strategy.** A gated clause asserts the rule the candidate must respect, not a specific solution path that satisfies it. A clause that locks in one license (e.g. "LICENSE-3 specifically") when the rule is "cite some license from the project list", or requires one specific simplification when a stronger contract-compliant alternative exists, is over-specified. Solution-path overfit shows up inside conjunctive content checks as readily as in top-level clauses: a predicate like "≥N items mention specific files X / Y / Z" when the underlying rule is "behavior-preserving items exist where preservable work exists" encodes a solution path (each named file always contributes ≥1 preservable item) the contract doesn't guarantee — a contract-compliant candidate may correctly drop a file where preservable work doesn't exist. **Operational test:** for every predicate in the clause (after the rule-1 decomposition), construct a contract-compliant counterexample — candidate output that obeys the contract and fails this predicate. If you can construct one, the predicate locks in a strategy the contract doesn't mandate; rewrite to assert the rule, or demote to non-gating. Canary output is not a warrant — that a candidate produced N items mentioning X in one run doesn't mean the contract requires it. Reframe to assert the rule, or move the implementation-specific expectation to non-gating.
- **Shared extraction criterion.** When multiple checks parse the same artifact for the same substructure (e.g. several checks all walk plan items in `plan.md`), define the extraction predicate once and reuse it across the related checks. A bug in one extractor is then a bug in one place, not four.
- **Run-state validity.** A clause that asserts a candidate-produced value must name the **run-state the value is valid in** and check against the artifact at that state, not against live workspace state at grading time. The same artifact a clause reads can transition across scenario states (post-Phase-1, post-apply, post-regen, post-VALIDATION-FAILED, mid-resume); a value the contract guarantees at one state may legitimately diverge from live state at another by design (a Phase-1 SHA acting as a drift detector, a ledger marker preserved across regen, a queue entry mid-transition QUEUED → ANSWERED → APPLIED-FROM-QUESTIONS). For each scenario in `Exercises checks`, name the per-scenario **states evaluated** and the **expected-value source** (the captured-at-state artifact, not the live one — for a Phase-1 hash post-apply, the comparison target is the source file as-of-Phase-1 or shape-only, not the live SHA). When the value is one the candidate records once and the comparison target later diverges, prefer asserting a derived observation that's stable across states (the ledger line the candidate writes when its own check fires, the post-resume position the candidate computes) over re-asserting the value itself. A clause whose declared state isn't reachable from any scenario's exercised states demotes to non-gating; a clause that needs different expected values per state splits into per-state sub-clauses. Failure mode: silent-pass at one state (typically post-Phase-1 "fresh" artifacts) and false-fail at any other state because the contract permits the artifact to be stable at its captured value while live state moves on.
- **Accept every legal rendering of a multi-form field.** A field the contract permits to render more than one legal way (a count as bare `(3)` or unit-annotated `(3 files)`; a kept-line ref as a col-0 entry or a prose bullet; an action token `REWRITE` / `DEL` / `ADD`) must have a clause that accepts ALL of its contract-legal forms — enumerate them from the contract (prompt template + rule files), NOT from the single canary capture. A clause that matches only the form the canary happened to emit is over-specified: a contract-compliant candidate that picks another legal form false-fails. If the contract is silent on which form is required (so subagents vary run-to-run while staying legal), the clause accepts the union of legal forms and the rendering choice is a non-gating clarity note, not a gated assertion.

Examples (for a multi-phase orchestration target):

- a required ledger field is present and well-formed in `progress.md`;
- after `/clear`+resume, the run continued from the next un-recorded ledger item — not earlier (rework) or later (skipped work);
- no plan item carries two outcome lines for one generation (no duplicated state);
- every `progress.md` line matches a defined ledger shape;
- no rule codes (`M3`, `D.1`, etc.) appear in any user-facing message;
- the slug-collision scenario stopped the run and reported, rather than overwriting a note;
- the run reached a defined terminal state, not a stall.

### Non-gating notes

Anything that needs a judgment call. Examples:

- was the run appropriately conservative?
- are the behavior-changing proposals genuinely grounded in the code?
- is the user-facing prose actually clear?

Non-gating notes are evaluated as observations and collected into `report.md` for the user. **Never gated on. Never auto-fixed.**

### Classifying every "must"

The orchestrator walks every requirement in `SKILL.md` and applies one rule:

> If satisfying the requirement leaves an **objective trace** — in a progress file or in the run's output — that a deterministic assertion can verify, it is a **gated check**. Otherwise it is a **non-gating note**.

Borderline requirements go to non-gating: a gated check must be one the orchestrator can never be wrong about. The Plan-stage approval checkpoint surfaces the per-requirement classification so the user can move any disagreement.

## Running a scenario — the candidate as a file

A run executes the target skill **by following `candidate/SKILL.md` as a file**, not by `/`-invoking the installed skill (which would load `.claude/skills/<target>/`, the live copy). Following the file is what puts the candidate under test and leaves the installed skill untouched until promotion.

The run instruction the orchestrator follows:

> Read `candidate/SKILL.md` and follow it exactly as written, as if it had just been loaded as a skill. Resolve every `references/…` and `scripts/…` path it mentions relative to `candidate/`. Treat `workspace/` as the repository it operates on. Take the invocation arguments and the fixed prompt-answers from the scenario record.

**Reproduce the candidate's own subagent prompts verbatim.** When the candidate dispatches its own subagents from a prompt template (e.g. a `references/agent-prompts.md` payload), send that template byte-for-byte, applying only the candidate's own documented placeholder substitutions (e.g. `<file>`/`<slug>`/`<N>`/`<repo>`) plus the candidate→`candidate/` base-directory redirects already named above. Do not condense, paraphrase, summarize, or drop any part — a dropped self-check or output-format rule lets a candidate defect through while looking like the candidate's own gap, which destroys defect attribution. The binding requirement is verbatim reproduction. **For any payload re-used across batches or scenarios, prefer file-pointer dispatch: write the substituted payload to a file at the work-folder root (never inside `workspace/`) once, then have each subagent Read and execute it verbatim — identical bytes reach every subagent, nothing to re-transcribe. Hand-transcribing inline per dispatch risks a paraphrase that injects a defect the candidate never produced (a reworded output-format line that false-fails a note-format check), destroying attribution. Inline transcription is acceptable only for a one-off payload, and even then byte-for-byte.**

The only thing `/`-invocation adds over following the file is the skill system binding the skill's base directory; the run instruction supplies that explicitly — base directory is `candidate/`. If a run ever shows the framing itself changed behavior, that is a finding for the report, not something the loop silently absorbs.

**Each run works on a fresh fixture copy.** A run mutates its workspace. Before a fresh scenario run the orchestrator resets the workspace: `rm -rf workspace && cp -R fixture workspace`. On resume of the **second half** of a mid-scenario `/clear`, the orchestrator skips the reset — the partial state is what the resume scenario tests. `fixture/` itself stays pristine.

The orchestrator grades inline immediately after the scenario terminates (per `references/evaluate-and-fix.md`) — no separate transcript file, no separate judge subagent.

## Run output capture

Stateless candidates produce their output as the assistant's final message in a scenario's response. Gated checks that read run output need a durable artifact (the conversation log is gone post-`/clear`), so the orchestrator captures the report.

- **Path:** `run-output/<scenario-id>.txt` at the **work-folder root** — NEVER inside `workspace/`. Same boundary as `canary-output/`: a file written inside `workspace/` rides along in the next `cp -R fixture workspace` and shows as untracked in the scenario's `git status`, false-failing any clean-tree gated check on a target that inspects the tree (e.g. a commit / clean-tree skill). (`_report.txt` below is shorthand for this file.)
- **What:** the candidate's final assistant message verbatim, no orchestrator commentary or framing.
- **When:** immediately after the candidate's final message, before any `/clear` or further tool calls.
- **Empty case:** if the candidate emits no closing summary, `_report.txt` is empty. The empty case is its own signal — not an orchestrator error.
- **Cascade rule:** if `_report.txt` is empty or missing, gated checks that depend on it log a single defect `report-empty` rather than separately failing each dependent check (G-checks named "report contains X" / "report has Y line" would otherwise multiply one root cause into many defects).

Stateful candidates that write their own progress files and emit no separate final summary do not need `_report.txt`; their gated checks read the progress files directly.

## Char-count metric — bytes

When a check or non-gating note in `test-spec.md` references `chars`, the count is **bytes** (the `wc -c` convention). This matters for candidates operating on files with non-ASCII content: a file with em-dashes or curly quotes has more bytes than Unicode code points (e.g. 2655 bytes vs 2645 code points for the same content). Bytes is what tooling reports; the spec uses one metric throughout.
