---
name: deep-simplify
description: "[rp] Deep step-back simplification via staged subagents — per-file notes to disk, cross-file synthesis, then a batched behavior-aware plan; default scope is uncommitted files, plan is the checkpoint. User-initiated only; don't auto-trigger on mentions."
---

# Deep Simplify

## Goal

- Rewrite code simpler/clearer at the mechanism level — "this shouldn't exist", "this defends an unreachable state"; not per-rule cleanup.
- May change behavior when a project runtime invariant licenses it.
- Working notes on disk; orchestrator holds the index + summaries + `plan.md` only, never source or note bodies.

## Trigger

- User-initiated only: `/deep-simplify` or an explicit deep-simplify request using subagents.
- Don't trigger on mentions of `deep-simplify.md`. One-off simplification → do it directly.

## Rule stack

Every phase (1, 2, 3) reads the same ordered rules, so synthesis classifies with the same rulebook as the per-file agents:

1. `.claude/skills/deep-simplify/deep-simplify.md` — moves, behavior-change protocol, conservative bias (project-agnostic).
2. `<repo>/dev/code-rules/deep-simplify.md` — project runtime-invariant **license list** + worked examples, as additions/overrides.
3. `<repo>/AGENTS.md` (or equivalent conventions file) — project invariants and validation commands.

Also read `.claude/skills/review-structure/structure.md` (+ project supplement) — a simpler rewrite must still satisfy the shaping rules.

Record resolved paths in `progress.md`. **No `dev/code-rules/deep-simplify.md` → no license list → every proposal is behavior-preserving; no behavior-changing simplification is licensed.**

## Files to audit

`$ARGUMENTS`

- **`$ARGUMENTS` given** — use that exact scope (folder, glob, file list). Confirm before dispatching if large or ambiguous.
- **`$ARGUMENTS` empty** — default = all uncommitted files from `git status --porcelain`. Resolve each entry to one existing readable path: skip `D `/` D` (deletion); use the **new** path for `R old -> new`; expand untracked-dir entries (`?? path/`) via `git ls-files --others --exclude-standard <path>`. No folder/file-type filter (`git status` already excludes `dist/`, `node_modules/`, gitignored). Skip unreadable binary assets. State the resolved list to the user; let them trim/widen/redirect — that confirmation is the filter, not a hardcoded path rule.
- Never hardcode a folder or file type — `src/` / `src/phaser/` / `.ts` aren't special, just a scope the user might pass. Don't autonomously pick files beyond the all-uncommitted default.
- Non-`.ts` files (CSS, HTML, Markdown) are in scope when uncommitted; runtime-invariant licenses won't apply, so their candidates come out behavior-preserving.
- Test files in scope are audited like any other file. Under `src/tests/` (per `AGENTS.md`), they match the `src/**` game-runtime rule in Phase 4 — default mode pauses on every test-file judgment call. A behavior-changing item additionally writes/rewrites its guard test on apply.

## Work folder

`.deep-simplify.local/` at the repo root. The repo's `.gitignore` `*.local/` pattern covers it — check once; add the line only if that pattern is absent.

Layout:

- `notes/<source-file-path>.md` — one per-file note (Phase 1). Note path mirrors source path under `notes/` with `.md` appended (`src/foo.ts` → `notes/src/foo.ts.md`); orchestrator `mkdir -p` parents before writing. Two source files always map to two different note paths — no slug substitution, no collision. If the note already exists this run, **stop and report a duplicate-write attempt** — never overwrite.
- `cross-file.md` — cross-file synthesis (Phase 2).
- `plan.md` — batched, ordered, two-track plan (Phase 3). The deliverable.
- `plan-g<n>.md` — each superseded plan generation, copied by Phase 3 before a regen overwrites `plan.md`, so the prior plan stays addressable. See Phase 3 for when this copy happens.
- `pre-edit/g<gen>/<source-path>` — a copy of each file a behavior-changing item touches (source + its guard test), written just before that item's edit in Phase 4. Makes a mid-apply crash or wrong rewrite recoverable beyond git's last commit and keeps each applied diff reviewable. Only behavior-changing items snapshot; behavior-preserving items rely on git.
- `questions.md` — every item needing a human decision, accumulated with full decision context (Phase 4 do-all mode). Each entry begins with a `Qid: q<gen>-<plan-item-num>` line the ledger references — duplicate detection on crash recovery is by id lookup, not content match.
- `progress.md` — run scope, Phase 4 mode, resolved rule-stack paths, repo root + branch at start, current `plan.md` generation, batch ledger, phase/batch position. The resume anchor. Per-file hashes live on each note's `Hash:` line, not here.

On resume, the orchestrator walks `notes/**.md` recursively to enumerate existing notes.

## Ledger format

`progress.md` lines follow fixed shapes. Two kinds:

**Per-outcome lines** — one per plan item as it's handled:

- `- plan:g<gen>:#<item-num> <outcome>` — `<gen>` is plan generation (Phase 3 records `1` on first write; a stale-file regeneration increments). `<outcome>` is one of `APPLIED`, `SKIPPED`, `DEFERRED` (superseded-generation item, per the Phase 4 re-hash rule), `QUEUED-TO-QUESTIONS qid=q<gen>-<item-num>` (do-all), `ANSWERED-APPROVED qid=...` / `ANSWERED-DECLINED qid=...` (do-all end-of-run review), `APPLIED-FROM-QUESTIONS qid=...` (do-all, any approved must-own item applied at end), or `SUPERSEDED qid=...` (a queued item whose plan item a later regeneration dropped — closes the qid with no user decision). The `qid` is the stable handle into `questions.md`; the embedded generation keeps it unique across regens.

On resume, the orchestrator acts only on plan-item lines whose `g<gen>` matches the current `plan.md` generation; superseded-generation plan-item lines are audit trail only. **Exception: `qid=...` lines (do-all queue events) are not filtered by current generation** — a `QUEUED-TO-QUESTIONS qid=q1-7` from gen 1 stays the live queue signal across regens until it pairs with `ANSWERED-APPROVED qid=q1-7`, `ANSWERED-DECLINED qid=q1-7`, or `SUPERSEDED qid=q1-7`. The orchestrator resolves a prior-gen qid against `plan-g<n>.md`. "Un-recorded item" = no current-generation per-outcome line for the plan path, or (for queue/answer events) no matching `qid` line — `SKIPPED`, `DEFERRED`, `QUEUED`, `ANSWERED`, and `SUPERSEDED` states are all recorded, so resume never re-processes them.

**Markers** — batch/phase-level, not tied to one item:

- `- rehashed g<gen> <file>` — written by Phase 4 once per generation per file after a successful re-hash. Survives `/clear` so the "once per generation" optimization holds across context resets.
- `- VALIDATION-FAILED g<gen> batch <X> item <N>` — validation broke during apply. Phase-level gate uses `item -`. **In-session, this marker stops the run immediately — no auto-chain to the next batch until a `VALIDATION-CLEARED` line lands**; resume also stops.
- `- VALIDATION-CLEARED g<gen> batch <X>` — recovery line. Written only after the user confirms the break is fixed and validation passes again.
- `- PARTIAL-MULTI-FILE g<gen> #<item-num> <file>,<file>,...` — written when a `MULTI-FILE` set's pre-checked anchors all matched but a mid-sequence Edit failed (a race past the pre-check), listing files already mutated. Stops the run; resume refuses to continue until the user manually reverts the partial mutations and writes `MULTI-FILE-CLEARED g<gen> #<item-num>`.
- `- REGEN-IN-FLIGHT g<prev-gen>` — a plan regeneration (the Phase 4 re-hash recovery, or the resume-time scope extension) is mid-flight. Written as the regeneration's first action, cleared only once the new-generation `plan.md` is written and its generation recorded. Unlike the stop markers, an open `REGEN-IN-FLIGHT` on resume means **re-enter and finish the regeneration** (its phases are re-runnable) before doing anything else — a now-matching note hash does not mean the regeneration completed; only the recorded generation increment does.
- A `VALIDATION-FAILED` with no following `VALIDATION-CLEARED`, or a `PARTIAL-MULTI-FILE` with no following `MULTI-FILE-CLEARED`, means the run is broken: resume stops and surfaces it before doing anything else. (An open `REGEN-IN-FLIGHT` is not a broken-run stop — resume re-runs the regeneration instead.)

## Workflow

Phases serial. Within a phase, subagents run in parallel (~5 per batch, serial across batches, size-balanced). After every batch, append to `progress.md` so the run survives a context reset. A subagent that errors or returns malformed output in-session (distinct from a valid `UNSTABLE` / no-finding return) is re-dispatched once; a second failure surfaces to the user — never silently drop it.

### Run start — resume or fresh

Check `.deep-simplify.local/` **before** resolving a new scope, starting work, or creating any subtree — creating `notes/`/`progress.md` first would make the resume check match this run's own fresh files instead of a prior run's.

- **Empty or absent folder.** Fresh run. Resolve scope (per *Files to audit*), create `.deep-simplify.local/notes/` (Phase 1 subagents `mkdir -p` sub-dirs as they write) before writing `progress.md`, write the initial `progress.md` (scope + resolved rule-stack paths + repo root + current branch; Phase 4 mode and plan generation added later — see Phases 3 and 4), proceed to Phase 1.
- **Non-empty folder, `progress.md` missing or unreadable.** Stop and ask whether to reset; never guess at state.
- **Non-empty folder, `progress.md` valid.** Read it. Report the saved scope, the saved Phase 4 mode (if Phase 4 was reached), which phase the run was in, which batch within that phase. Ask **resume** or **reset** (wipe and restart). Never silently overwrite a prior run.

On resume:

- Saved scope and Phase 4 mode win. New `$ARGUMENTS` conflicting with the saved scope → ask whether the user meant **reset** (start over with new scope) or **resume** (ignore new arguments). A resumed do-all run stays in do-all mode even when the resume invocation omits "do all" — saved mode is authoritative, not the resume wording.
- Verify the repo root and current branch match what `progress.md` recorded at start. Either differs → stop and confirm.
- If saved scope was "all uncommitted files" and the working tree has new uncommitted files now, list them and ask whether to add or hold for a later run. **On "add"**: write `- REGEN-IN-FLIGHT g<prev-gen>` first, then extend the saved scope in `progress.md`, dispatch Phase 1 for the new files (their notes don't exist yet — Phase 1 partial-resume picks them up), re-run Phase 2 (synthesis must include the new notes), then re-dispatch Phase 3 in regen mode (so `plan.md` covers the new files alongside any un-applied prior-generation work) and record the new generation, clearing `REGEN-IN-FLIGHT` — all **before** continuing Phase 4. Never proceed in Phase 4 against a plan that doesn't cover the new scope; an open `REGEN-IN-FLIGHT` on resume re-runs this sequence to completion first.
- For each phase, dispatch only work not already completed — see per-phase partial-resume rules below.

### Phase 1 — Per-file deep read (parallel subagents, notes to disk)

One subagent per file (template in `agent-prompts.md`). Each writes `notes/<source-file-path>.md` with the file's SHA-256 on the second line of the note (`Hash: <sha256>`, immediately under the heading), and returns **only** `<file> — <n> candidates (<#preserving>/<#changing>), <m> cross-file hooks` (or `<file> — UNSTABLE` if the file changed mid-analysis — see Phase 1 prompt step 2). The orchestrator never receives the note body. The hash lives in the note (not `progress.md`) so parallel subagents never write to `progress.md` concurrently.

**Partial-resume.** List expected note paths from the saved scope (one per source file, `notes/<source-file-path>.md`). For each, dispatch a subagent only if the note is missing, exists but **lacks a parseable `Hash:` line** (Write interrupted mid-output), OR the note's `Hash:` doesn't match the file's current SHA-256. In any of the three re-dispatch cases, the orchestrator first deletes the existing note (if any) so the duplicate-write stop doesn't fire on re-run. Completed notes whose hashes still match are reused as-is. On an `UNSTABLE` return, queue the file for re-dispatch after the current Phase 1 batch finishes (the file is mid-edit; retry once the user pauses) — capped at 2 consecutive `UNSTABLE` returns for the same file. On a third, stop and tell the user in plain English that the file keeps changing mid-read, so they can pause edits to it or drop it from scope rather than the run re-queuing forever.

### Phase 2 — Cross-file synthesis (one subagent: notes, then verify at code)

Before dispatching, re-hash every Phase 1 note's file; on any mismatch, re-run Phase 1 for that file first (same rule Phase 4 applies). One subagent reads every `notes/` file + the rule stack, clusters cross-file hooks into candidates, then **verifies each candidate against the actual code with targeted `rg`/import reads** before writing `cross-file.md`. The subagent does the verifying reads itself (orchestrator stays flat). Never finalize a behavior classification or license from notes alone. A single strong hook is a candidate to verify — no "≥2 notes" gate (that would discard real single-note asymmetric hooks like a wrapper whose only callers are elsewhere). Returns one line.

**Partial-resume.** Single subagent, one output file (`cross-file.md`); interrupted → re-dispatch, discard partial output.

### Phase 3 — Plan synthesis (subagent; then stop, by default)

One subagent reads `notes/` + `cross-file.md` + the rule stack and writes `plan.md` (returns a summary — orchestrator doesn't hold note bodies). On first run the plan is generation `1`; the Phase 4 re-hash rule re-dispatches this phase to produce later generations. **Before regen overwrites `plan.md`, the orchestrator copies the current file to `.deep-simplify.local/plan-g<prev-gen>.md`** — `<prev-gen>` is the generation recorded in `plan.md` at the moment of the copy, the one regen is about to supersede. This keeps the prior plan addressable: the regen subagent resolves `<applied-list>` ordinals to content for content-match exclusion, and the orchestrator enumerates items whose edits land in a stale file for DEFERRED marking (see Phase 4 re-hash mismatch). `plan.md` carries `Generation: <n>` on its second line; the orchestrator records that generation in `progress.md`.

The plan is:

- **Two tracks.** Behavior-preserving (batchable). Behavior-changing — each carries its `License:`, `Original purpose:`, `Verified against:`, the `Announced change:` subject, and the `Guard test:` spec; never bundled.
- **Ordered** by the `Scope` + `Symbols` join: `LOCAL` before `MULTI-FILE` touching the same symbols; a cross-file consolidation that `supersedes`/`conflicts with` a per-file item is sequenced first and the superseded item dropped.
- **Batched** with a total count so Phase 4 can show `batch X/Y`.
- **Rule-codification items** listed explicitly: the doc edit + the violation sweep as one item.
- **Phase 2 `UNVERIFIED` candidates** folded in as numbered must-own items (their own track) — so every plan item, including ones that still need a code decision, has a number the do-all ledger and `questions.md` can anchor to.
- **Pinned item format** so resume and regen can re-parse `plan.md` reliably: one item per `### #<N> — <title>` heading (third-level, number first), each with bold-label field bullets — `- **Move:**`, `- **Behavior:** preserving|changing`, `- **Scope:** LOCAL|MULTI-FILE`, `- **Files + symbols:**`, `- **Description:**`; a behavior-changing item adds `- **License:**`, `- **Original purpose:**`, `- **Verified against:**`, `- **Announced change:**`, `- **Guard test:**`. The pin fixes the heading level and these labels, not the full field set (`From:`, `Supersedes:`, decision-context fields stay as used). The Phase 3 template (`agent-prompts.md`) carries the authoritative spec.

**Partial-resume.** Single subagent, one output file (`plan.md`); interrupted → re-dispatch, discard partial output.

**Default: stop here.** `plan.md` is the deliverable; the user reviews it. Phase 4 is opt-in — when the user opts in, record the Phase 4 mode (`default`) in `progress.md` before dispatching. **Override:** the user invokes with "do all" / "don't stop at the plan" → record mode (`do-all`) in `progress.md` and continue into Phase 4 in do-all mode.

### Phase 4 — Apply

**Re-hash every in-scope file once at the start of the generation, before applying the first item of that generation**, comparing each file's current SHA-256 to the `Hash:` line in its note. On a match, append `- rehashed g<gen> <file>` to `progress.md` so the optimization survives `/clear` — on resume, skip files with a current-generation `rehashed` line. Skip the check for:

- A file already applied to in the current generation (derive the applied-to set by mapping current-gen `APPLIED` ledger lines back to file paths via `plan.md`) — apply changes a file's hash, so re-checking already-touched files would always mis-fire.
- Files touched only as cross-file callsites (no Phase 1 note, no `Hash:` to compare).

The anchor-miss check at apply time is the safety net for the rest.

Mismatch on that first check → the file changed out-of-band since Phase 1; its note is stale. Recovery:

1. **Write `- REGEN-IN-FLIGHT g<prev-gen>` to `progress.md` first** — until the new generation is recorded, this marker (not the note hash) is what tells resume a regeneration is mid-flight, because step 2 rewrites the note's hash to the current file and would otherwise silence the very mismatch that triggered this recovery.
2. Re-run Phase 1 for the stale file.
3. Re-run Phase 2 for any cross-file item that cites it.
4. **Copy current `plan.md` to `.deep-simplify.local/plan-g<prev-gen>.md`** so the prior plan body stays addressable.
5. Re-dispatch Phase 3 in regen mode (increments plan generation, reads `plan-g<prev-gen>.md` to resolve `<applied-list>` ordinals to content, omits items that content-match a prior-generation `APPLIED` entry or an open prior-generation `QUEUED-TO-QUESTIONS` qid). Record the new generation in `progress.md`.
6. Read `plan-g<prev-gen>.md`, enumerate every superseded-generation item whose edits land in the stale file (an item that only mentions the file — e.g. in a scope-exclusion note, or that clusters from its note but edits other files — is not deferred; its anchors against those other files still hold): write a `DEFERRED` ledger line for each, and for any that also has an open `QUEUED-TO-QUESTIONS` qid write a `SUPERSEDED qid=...` line so its queue entry is closed rather than left live with stale context.
7. Clear `REGEN-IN-FLIGHT`, then stop the current Phase 4 batch with a one-line note.

On resume: an open `REGEN-IN-FLIGHT g<prev-gen>` with no later generation increment means this recovery crashed mid-flight — re-run it to completion (its phases are re-runnable; a now-matching note hash does not mean it finished) before resuming Phase 4. Otherwise the new-generation plan runs from the start of Phase 4 (already excludes applied work, so no anchor-miss storm).

Two modes:

**Default mode (paused walkthrough).** Per batch: header `batch X/Y`; dump the batch's numbered items (one line each, file-labelled) **before asking anything**. Render every shown item per *Showing code during review* below. Then per item:

- Game-runtime files — `src/**` (incl. `src/phaser/`, `src/tests/`) and `data/**` — pause on every judgment call, options as plain text, free-form answer (no multi-select prompt).
- Carve-out: `dev/**`, `src/editor/**`, `src/static-pages/**` may auto-apply behavior-preserving items.
- Behavior-changing items: show `License:` + `Original purpose:` + `Verified against:` + `Announced change:` + the `Guard test:` spec; on sign-off, **first snapshot the file(s) it touches to `pre-edit/g<gen>/` (per *Work folder*)**, then apply the edit **and** write the pre-specified guard test in the same step; never bundled.
- Rule-codification items: apply per *Rule codification* below — the doc edit + the violation sweep as one change, routing the sweep through the `MULTI-FILE` pre-check; pause first if any swept file is under `src/**` or `data/**`.
- Removal items: dropping the orphaned imports and stale comment/header lines the item lists as its removal fallout is part of that single removal — apply them with it, not as a forbidden drive-by edit. A removal whose orphaned import is left in place fails the project's `noUnusedLocals` typecheck and stops the run.
- Apply behavior-preserving `LOCAL` one at a time per file. For a `MULTI-FILE` set, the orchestrator first dispatches a pre-check subagent that returns "all anchors match" or names the misses; only on full match does the orchestrator apply the set in sequence.
- Anchor miss (LOCAL or `MULTI-FILE` pre-check) → stop and report, triaged per *Anchor miss triage* below.
- Mid-`MULTI-FILE` apply failure after pre-check passed (rare — a race) → write `PARTIAL-MULTI-FILE g<gen> #<item-num> <files-mutated>` to `progress.md`, report, stop. Resume refuses to continue until the user manually reverts and writes `MULTI-FILE-CLEARED`.
- One-line recap per item; update `progress.md`; auto-chain to the next batch unless a `VALIDATION-FAILED`, `PARTIAL-MULTI-FILE`, or anchor-miss stop fired.
- Record any item whose `Edit` returned success as `APPLIED` regardless of validation outcome (the file actually changed); on a validation break, write a `VALIDATION-FAILED` marker alongside **and stop the run immediately — do not dispatch the next batch**. Report the failing command's output to the user.
- The `VALIDATION-CLEARED` recovery line is written only once the user confirms the fix and the orchestrator has re-run validation and seen it pass. On resume, a `VALIDATION-FAILED` with no `VALIDATION-CLEARED` after it stops the run before doing anything else.

**Partial-resume (default mode).** `progress.md` records each plan item (batch + index + outcome) as it lands. On resume, position advances to the next un-recorded item (no current-generation per-outcome line); never re-process recorded items, including `SKIPPED` and `DEFERRED`. Mid-batch position → finish that batch's remaining un-recorded items before advancing. Before applying the next un-recorded item on resume, re-run validation once for the items already applied this generation — the apply-then-validate window has no separate checkpoint, so a `/clear` after the last `APPLIED` but before validation is indistinguishable from a validated batch; resume re-validates rather than assume it passed. A failure is a `VALIDATION-FAILED` stop.

**Anchor miss triage.** When an Edit's anchor doesn't match, the orchestrator triages before reporting:

1. **Self-stale from upstream apply.** Failing file has an `APPLIED` ledger line earlier in the current batch (same run touched it) → anchor invalidated by an upstream item, a Phase 3 plan defect (anchors weren't computed against post-upstream state). Stop and report as `self-stale anchor — plan didn't account for upstream apply`; do not retry. The user re-runs Phase 3 in regen mode.
2. **Apply landed before ledger recorded it.** Else if `git diff <file>` shows the planned change is already present, the apply landed and the ledger crashed before the `APPLIED` write — mark `APPLIED`, recap, continue. **For a behavior-changing item, first confirm its pre-specified guard test is present** (the named test file/assertion exists): a crash between the source edit and the guard test leaves the source change present but the test missing, so write the guard test now, then mark `APPLIED`. Never mark a behavior-changing item `APPLIED` on a bare source-`git diff` match without its guard test — the failing-under-old-behavior test is the artifact the whole behavior-change protocol exists to produce.
3. **External drift.** Else (`git diff` shows the file changed in ways that don't match the planned edit, or unchanged but anchor still mismatches): out-of-band drift. Stop and report; the user resolves manually or invokes regen.

**Do-all mode ("do as much as possible, ask me once at the end").** Auto-apply **every behavior-preserving item across the whole scope**, including `src/**` and `data/**`. Every must-own item — every behavior-changing item, every genuine judgment call, every Phase 2 candidate that couldn't be verified, every rule-codification item — is **not applied**. For each, the orchestrator writes the `- plan:g<gen>:#<item-num> QUEUED-TO-QUESTIONS qid=q<gen>-<item-num>` ledger line **first**, then appends to `questions.md` a block whose first line is exactly `Qid: q<gen>-<item-num>` (a bare line, not a Markdown heading — no `## ` or other heading prefix) followed by the full decision context, gated by item kind: always the proposal, move, `Scope`, file:anchor, and the concrete options; a **behavior-changing** item adds `License:`, `Original purpose:`, `Verified against:`, `Announced change:`, and the `Guard test:` spec; a **rule-codification** item adds the proposed doc edit (which file, what rule text) and the violation sweep (the symbols/sites to change) instead of those behavior-changing fields; an **unverified candidate** adds what still needs a code decision.

Validate the auto-applied set per the project's `AGENTS.md`. Record each auto-applied item as `APPLIED` regardless of validation outcome (the file actually changed); on a validation break, write a `VALIDATION-FAILED` marker alongside **and stop the sweep immediately — no further auto-apply until `VALIDATION-CLEARED` lands**; on resume, a `VALIDATION-FAILED` without `VALIDATION-CLEARED` stops the run until the user confirms the fix.

At the **very end**, present `questions.md` as one batched review — flat numbered list first, then grouped (behavior-changing / rule-codification / unverified / judgment call), `batch X/Y`. The user answers all at once; as each answer is triaged, record `ANSWERED-APPROVED qid=...` or `ANSWERED-DECLINED qid=...`. Then apply each `ANSWERED-APPROVED` item by its kind, recording `APPLIED-FROM-QUESTIONS qid=...` as each lands:

- **Behavior-changing** — snapshot to `pre-edit/g<gen>/` (per *Work folder*) first, then apply with its pre-specified guard test in the same change.
- **Rule-codification** — the doc edit + the violation sweep, routing the sweep through the same `MULTI-FILE` pre-check + `PARTIAL-MULTI-FILE` recovery as any multi-file set.
- **Unverified candidate** — only after grounding it inline first (run the targeted `rg`/import check Phase 2 would have): grounds → apply; doesn't ground → record `SKIPPED` with the reason and surface it, since user approval never substitutes for grounding.
- **Judgment call** — apply the option the user chose, like any preserving or behavior-changing edit per that option. A judgment call whose plan recommendation is to leave the code as-is keeps that leave-it choice as its default: a single answer that approves everything at once does not override it, and it is recorded `ANSWERED-DECLINED` unless the user names the item to apply the change over its own recommendation.

Re-validate; recap. Never auto-commit. Report and stop — no downstream git offers.

**Partial-resume (do-all mode).** Both auto-applied items and queue events are checkpointed in `progress.md` as they happen (same per-item recording as default mode), not only at the end. The **ledger-first** order makes recovery deterministic:

1. **Orphan-`QUEUED` repair.** On resume, any `QUEUED-TO-QUESTIONS qid=q<g>-<n>` line without a matching `Qid: q<g>-<n>` block in `questions.md` is repaired by re-appending the entry from the corresponding plan item — read it from `plan.md` if `<g>` matches the current generation, else from the preserved `plan-g<g>.md`. No content-match heuristic — the `Qid` is the unique anchor.
2. **Resume position.** Continue auto-applying from the next un-recorded item; accumulated `questions.md` carries forward as-is. Before the next auto-apply on resume, re-validate the already-applied set once (same reason as default mode); a failure is a `VALIDATION-FAILED` stop.
3. **Sweep before review.** The end-of-run batched review fires only after the auto-apply sweep finishes.
4. **Review resumes by outcome.** Re-present only `Qid:` entries whose ledger line is still `QUEUED-TO-QUESTIONS` (an `ANSWERED-APPROVED`/`ANSWERED-DECLINED`/`SUPERSEDED qid=...` line means it's already triaged or dropped).
5. **Apply resumes by outcome.** Re-apply only `ANSWERED-APPROVED` items that lack an `APPLIED-FROM-QUESTIONS qid=...` line — so a reset during the answer-and-apply end-game never re-asks or double-applies.

Regen during the sweep preserves `questions.md` entries as-is (they're qid-anchored, not generation-anchored); their ledger lines stay valid since the qid format embeds the originating generation.

### Rule codification (a Phase 4 item category, not a separate phase)

Rule codification is a category of plan item — produced in Phase 3, applied in Phase 4 — with no subagent dispatch or resume state of its own (the run is never "in Phase 5"). For each rule-codification item: propose the `AGENTS.md` / `structure.md` / `structure-comments.md` / project-`deep-simplify.md` edit **and** the sweep of existing violations as one change (a rule isn't landed until it's written down and the violations are gone). The doc edit plus its sweep is inherently multi-file, so apply it through the `MULTI-FILE` pre-check + `PARTIAL-MULTI-FILE` recovery. Default mode reviews these inline (pausing first if any swept file is under `src/**` or `data/**`); do-all mode funnels them through `questions.md`.

## Subagent prompt templates

The Phase 1 (per-file), Phase 2 (cross-file synthesis), and Phase 3 (plan synthesis) subagent prompts live in `.claude/skills/deep-simplify/agent-prompts.md`. At each phase's dispatch point, read the relevant template and send it, substituting the placeholders it names: `<file>` / `<N>` / `<repo>` (Phase 1), `<repo>` (Phase 2), and `<repo>` / `<gen>` / `<prev-plan-path>` / `<applied-list>` / `<open-queue-list>` (Phase 3 regeneration). Each template is self-contained (carries its own rule-stack read order), so it can be sent to a subagent as-is.

## Showing code during review

- File-path comment on the first line of every block.
- Signatures and call shape only; bodies elided as `// N lines: <purpose>`.
- Mark `NEW` / `CHANGED — was X` / `unchanged`.
- Post-edit view only for extractions; reflect already-agreed renames.
- Behavior-changing items: additionally show `License:`, `Original purpose:`, `Verified against:`, and the `Guard test:` signature.
- Multi-option judgment calls: short code sample under each option, not just the prompt.

**No rule codes in user-facing text.** Move codes (`M1`–`M9`) and structure-guide cluster codes (`A.1`–`G.1`, `D.1`, `B.5`, etc.) live only inside the rule files as cross-references. In any text the user reads — batch headers, item descriptions during pause-for-judgment, trade-off presentations, options, recap lines — translate the code to short plain English. Don't write "this is an M3 centralization" or "M3 (centralize scattered constants)"; write "centralize the scattered `SLOW_TICK = 5` constants". Don't write "Per D.1, this guard…"; write "This guard defends against a state no caller produces". Internal scratch (`notes/`, `plan.md`, `cross-file.md`, `progress.md` ledger) may keep the codes; user-facing prose must not. When quoting a plan or notes item back to the user, translate before quoting.

## Context management

- **Every analysis pass is a subagent** — Phase 1, 2, 3. The orchestrator holds the index + summaries + `plan.md`, never source files or note bodies. Phase 3 is a subagent specifically so synthesizing 100 notes doesn't re-accumulate in the orchestrator.
- **A self-report is never the verdict.** The orchestrator's own re-run is authoritative — Phase 2 re-grounds every classification against the code, and apply re-validates regardless of a subagent's recap. A requirement no note or progress line can settle is a non-gating judgment call, not a gated check.
- **State on disk.** `notes/` (with per-file hashes on each note's `Hash:` line), `cross-file.md`, `plan.md`, `questions.md`, and `progress.md` are the run. Nothing needed to resume lives only in context.
- **Checkpoint every batch** before starting the next.
- **Target ≤200K per orchestrator session.** Quality drops well before the model's full window fills — anchor on 200K even on 1M-context models. The reset below is the fallback, not the plan.
- **When context is heavy**, say so plainly and tell the user to `/clear` and re-invoke — the run resumes from `progress.md` + `plan.md` + `notes/` + `questions.md` with no loss. Prefer a subagent over letting context fill.

## Per-file gotchas worth flagging when dispatching

- **Performance-tuned code** (rendering, hot loops, caches, throttling, pooling, culling): performance-driven structure looks like over-decomposition. If a comment cites a measurable cost, it stays.
- **Code with preconditions/invariants** (validators, parsers, state machines): a guard whose comment names a real rule it enforces is licensed by that rule, not removable. Removable guards defend against states the runtime can't reach.
- **Files with broad responsibility by design** (manager classes, top-level orchestrators): the project assigns these broad ownership. Size alone isn't a simplification target.
- **Data / content files**: trusted internal input. The simplification is usually M2/M3 (derive, centralize), not extraction. Don't touch displayed-text fields.
- **The boundary, not past it**: the project's single save/validation boundary stays; collapse re-validation behind it, never the boundary check itself.
- **Real change boundaries look like duplication**: a near-duplicate or thin adapter across a testability seam, an error-handling/validation layer, a public API contract, or a data-vs-render / boundary-vs-core split is kept per the rule stack's Keep-signals, not collapsed. Merging two modules that change at different rates couples those rates. When the overlap is incidental and no testability, validation, public-contract, cadence, or AGENTS-boundary explains it, collapse it: a real seam relocates complexity, an accidental one removes it.

## Tuning the batch

- Size-balance batches; ~5 subagents per batch, parallel within, serial across.
- Re-hash every in-scope file once at the start of each plan generation, before the first applied item, per the *Phase 4 — Apply* re-hash rule (covers the `/clear`-surviving `rehashed` marker, the skip-set for already-applied and note-less callsite files, and the stale → re-run Phase 1 + Phase 2 → regenerate-the-plan recovery).
- Validate per `AGENTS.md` after each apply batch; for behavior-changing simulation items the project's economy/trade simulation is the real net, not just typecheck. Report results in plain English.
- A `<new-diagnostics>` / IDE-LSP error surfaced the instant an apply-subagent returns is an **unconfirmed mid-edit snapshot, not ground truth** — the LSP routinely indexes a half-applied state (import renamed, call site not yet) that is already consistent in the subagent's final write. Don't edit the flagged file, don't re-dispatch, don't override the subagent's recap, and don't spend an extra `typecheck`/`lint` per alarm to disprove it. The **already-scheduled** group-boundary / final gate is the single authoritative check; only diagnostics that survive that scheduled run are real — fix them there, in the fix-loop. If a real error genuinely can't wait (a later group builds on the suspect file), bring that gate forward to now rather than blind-editing on the snapshot.
- Commit only when the user asks. Report and stop — no downstream git offers.
