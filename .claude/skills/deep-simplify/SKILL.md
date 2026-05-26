---
name: deep-simplify
description: "[rp] Deep step-back simplification via staged subagents — per-file notes to disk, cross-file synthesis, then a batched behavior-aware plan; default scope is uncommitted files, plan is the checkpoint"
---

# Deep Simplify

## Goal

- Rewrite code simpler or clearer at the mechanism level — "this shouldn't exist" / "this defends an unreachable state" judgments, not per-rule cleanup.
- May change behavior when a project runtime invariant licenses it.
- Working notes live on disk so scope isn't bounded by one context window; the orchestrator holds the index + summaries + `plan.md` only, never source or note bodies.

## Trigger

- User-initiated only: run on `/deep-simplify` or an explicit deep-simplify request using subagents.
- Don't trigger on mentions of `deep-simplify.md` (the rules) — for a one-off simplification, do it directly.

## Rule stack

Every phase (1, 2, 3) reads the **same** ordered rules so synthesis classifies with the same rulebook as per-file agents:

1. `.claude/skills/deep-simplify/deep-simplify.md` — moves, behavior-change protocol, conservative bias (project-agnostic).
2. `<repo>/dev/code-rules/deep-simplify.md` — project runtime-invariant **license list** + worked examples, as additions/overrides.
3. `<repo>/AGENTS.md` (or equivalent conventions file) — project invariants and validation commands.

Also read `.claude/skills/review-structure/structure.md` (+ project supplement) — a simpler rewrite must still satisfy the shaping rules.

Record resolved paths in `progress.md`. **No `dev/code-rules/deep-simplify.md` → no license list → every proposal is behavior-preserving; no behavior-changing simplification is licensed.**

## Files to audit

`$ARGUMENTS`

- **`$ARGUMENTS` given** — use that exact scope (folder, glob, or explicit file list). Confirm before dispatching if large or ambiguous.
- **`$ARGUMENTS` empty** — default = all uncommitted files, parsed from `git status --porcelain`. Resolve each entry to a single existing readable file path: skip entries with status `D `/` D` (deletion — file is gone from disk), use the **new** path for `R old -> new` rename entries, and expand untracked-directory entries (`?? path/`) into their constituent files via `git ls-files --others --exclude-standard <path>`. No folder or file-type filter — `git status` already excludes `dist/`, `node_modules/`, and everything gitignored. Skip unreadable binary assets. State the resolved list back to the user; let them trim/widen/redirect before dispatching — that confirmation is the filter, not a hardcoded path rule.
- Never hardcode a folder or file type — `src/` / `src/phaser/` / `.ts` are not special, just a scope the user might pass. Don't autonomously pick files beyond the all-uncommitted default.
- Non-`.ts` files (CSS, HTML, Markdown) are in scope when uncommitted; runtime-invariant licenses won't apply, so their candidates come out behavior-preserving.
- Test files in the uncommitted set are audited like any other file. They live under `src/tests/` (per `AGENTS.md`), which matches the `src/**` game-runtime rule in Phase 4 — Phase 4 default mode pauses on every test-file judgment call. A behavior-changing item additionally writes/rewrites its guard test on apply.

## Work folder

`.deep-simplify.local/` at the repo root. The repo's `.gitignore` `*.local/` pattern covers it — check once; add the line only if that pattern is absent.

Layout:

- `notes/<source-file-path>.md` — one per-file note (Phase 1). The note path mirrors the source file path under `notes/` with `.md` appended (`src/foo.ts` → `notes/src/foo.ts.md`); the orchestrator `mkdir -p` parent dirs before writing. Two different source files always map to two different note paths — no slug substitution, no collision. Before writing, if the note file already exists this run, **stop and report a duplicate-write attempt** — never overwrite a note (silent overwrite loses a file's analysis with no anchor-miss-style stop).
- `cross-file.md` — cross-file synthesis (Phase 2).
- `plan.md` — the batched, ordered, two-track plan (Phase 3). The durable deliverable.
- `plan-g<n>.md` — every prior plan generation, preserved when Phase 3 regen runs (so the regen subagent can resolve `<applied-list>` ordinals to content for content-match exclusion, and the orchestrator can enumerate items that referenced a stale file for DEFERRED marking). Phase 3 copies the current `plan.md` to `plan-g<current-gen>.md` before overwriting it.
- `questions.md` — every item that needs a human decision, accumulated with full decision context (Phase 4 do-all mode). Each entry begins with a `Qid: q<gen>-<plan-item-num>` line the ledger references — duplicate detection on crash recovery is by id lookup, not content match.
- `progress.md` — run scope, Phase 4 mode, resolved rule-stack paths, repo root + branch at start, current `plan.md` generation, batch ledger, phase/batch position. The resume anchor. Per-file hashes live on each note's `Hash:` line, not here.

On resume, the orchestrator walks `notes/**.md` recursively to enumerate existing notes.

## Ledger format

`progress.md` lines follow fixed shapes. Two kinds:

**Per-outcome lines** — one per plan item as it is handled:

- `- plan:g<gen>:#<item-num> <outcome>` — `<gen>` is the plan generation (Phase 3 records `1` on first write; a stale-file regeneration increments it). `<outcome>` is one of `APPLIED`, `SKIPPED`, `DEFERRED` (superseded-generation item, per the Phase 4 re-hash rule), `QUEUED-TO-QUESTIONS qid=q<gen>-<item-num>` (do-all), `ANSWERED-APPROVED qid=...` / `ANSWERED-DECLINED qid=...` (do-all end-of-run review), or `APPLIED-FROM-QUESTIONS qid=...` (do-all, approved behavior-changing item applied at end). The `qid` is the stable handle into `questions.md`; it embeds the originating generation so it stays unique across regens.

On resume, the orchestrator acts only on plan-item lines whose `g<gen>` matches the current `plan.md` generation; superseded-generation plan-item lines are audit trail only. **Exception: `qid=...` lines (do-all queue events) are not filtered by current generation** — a `QUEUED-TO-QUESTIONS qid=q1-7` from gen 1 stays the live queue signal across regens until it pairs with `ANSWERED-APPROVED qid=q1-7` or `ANSWERED-DECLINED qid=q1-7`. The orchestrator resolves a prior-gen qid against `plan-g<n>.md` (preserved by Phase 3 regen). "Un-recorded item" = no current-generation per-outcome line for the plan path, or (for queue/answer events) no matching `qid` line — `SKIPPED`, `DEFERRED`, `QUEUED`, and `ANSWERED` states are all recorded, so resume never re-processes them.

**Markers** — batch/phase-level, not tied to one item:

- `- rehashed g<gen> <file>` — written by Phase 4 once per generation per file after a successful re-hash. Survives `/clear` so the "once per generation" optimization holds across context resets (per *Phase 4 — Apply* re-hash rule).
- `- VALIDATION-FAILED g<gen> batch <X> item <N>` — validation broke during apply. Phase-level gate uses `item -`. **In-session, this marker stops the run immediately — no auto-chain to the next batch until a `VALIDATION-CLEARED` line lands**; resume also stops.
- `- VALIDATION-CLEARED g<gen> batch <X>` — recovery line. Written only after the user confirms the break is fixed and validation passes again.
- `- PARTIAL-MULTI-FILE g<gen> #<item-num> <file>,<file>,...` — written when a `MULTI-FILE` set's pre-checked anchors all matched but a mid-sequence Edit failed (a race past the pre-check), listing files already mutated. Stops the run; resume refuses to continue until the user clears the marker by manually reverting the partial mutations and writing `MULTI-FILE-CLEARED g<gen> #<item-num>`.
- A `VALIDATION-FAILED` with no `VALIDATION-CLEARED` after it, or a `PARTIAL-MULTI-FILE` with no `MULTI-FILE-CLEARED` after it, means the run is broken: resume stops and surfaces it before doing anything else.

## Workflow

Phases serial. Within a phase, subagents run in parallel (~5 per batch, serial across batches, size-balanced). After every batch, append to `progress.md` so the run survives a context reset.

### Run start — resume or fresh

Before resolving a new scope or starting any work, check `.deep-simplify.local/`.

- **Empty or absent folder.** Fresh run. Resolve scope (per *Files to audit*), create `.deep-simplify.local/notes/` (Phase 1 subagents `mkdir -p` sub-dirs as they write) before writing `progress.md`, write the initial `progress.md` (scope + resolved rule-stack paths + repo root + current branch; Phase 4 mode and plan generation added later — see Phases 3 and 4), proceed to Phase 1.
- **Non-empty folder, `progress.md` missing or unreadable.** Stop and ask whether to reset; never guess at state.
- **Non-empty folder, `progress.md` valid.** Read it. Report the saved scope, the saved Phase 4 mode (if Phase 4 was reached), which phase the run was in, which batch within that phase. Ask **resume** or **reset** (wipe and restart). Never silently overwrite a prior run.

On resume:

- Saved scope and Phase 4 mode win. New `$ARGUMENTS` conflicting with the saved scope → ask whether the user meant **reset** (start over with new scope) or **resume** (ignore new arguments). A resumed do-all run stays in do-all mode even when the resume invocation omits "do all" — saved mode is authoritative, not the resume wording.
- Verify the repo root and current branch match what `progress.md` recorded at start. Either differs → stop and confirm — the user may have changed checkouts.
- If the saved scope was "all uncommitted files" and the working tree has new uncommitted files now, list them and ask whether to add or hold for a later run. **On "add"**: extend the saved scope in `progress.md`, then dispatch Phase 1 for the new files (their notes don't exist yet — Phase 1 partial-resume picks them up naturally), then re-run Phase 2 (cross-file synthesis must include the new notes), then re-dispatch Phase 3 in regen mode (so `plan.md` covers the new files alongside any un-applied prior-generation work) **before** continuing Phase 4 — never proceed in Phase 4 against a plan that doesn't cover the new scope.
- For each phase, dispatch only work not already completed — see per-phase partial-resume rules below.

### Phase 1 — Per-file deep read (parallel subagents, notes to disk)

One subagent per file (template below). Each writes `notes/<source-file-path>.md` with the file's SHA-256 on the second line of the note (`Hash: <sha256>`, immediately under the heading), and returns **only** `<file> — <n> candidates (<#preserving>/<#changing>), <m> cross-file hooks` (or `<file> — UNSTABLE` if the file changed mid-analysis — see Phase 1 prompt step 2). The orchestrator never receives the note body. The hash lives in the note (not `progress.md`) so parallel subagents never write to `progress.md` concurrently.

**Partial-resume.** List expected note paths from the saved scope (one per source file, `notes/<source-file-path>.md`). For each path, dispatch a subagent only if the note is missing, the note exists but **lacks a parseable `Hash:` line** (Write was interrupted mid-output), OR the note's `Hash:` doesn't match the file's current SHA-256. In any of the three re-dispatch cases, the orchestrator first deletes the existing note file (if any) so the subagent's duplicate-write stop doesn't fire on re-run. Completed notes whose hashes still match are reused as-is. On an `UNSTABLE` return, the orchestrator queues the file for re-dispatch after the current Phase 1 batch finishes (the file is mid-edit; retry once the user pauses).

### Phase 2 — Cross-file synthesis (one subagent: notes, then verify at code)

Before dispatching, re-hash every Phase 1 note's file; on any mismatch, re-run Phase 1 for that file first (same rule Phase 4 applies). One subagent reads every `notes/` file + the rule stack, clusters cross-file hooks into candidates, then **verifies each candidate against the actual code with targeted `rg`/import reads** before writing `cross-file.md`. The subagent does the verifying reads itself (orchestrator stays flat). Never finalize a behavior classification or license from notes alone. A single strong hook is a candidate to verify — no "≥2 notes" gate (that would discard real single-note asymmetric hooks like a wrapper whose only callers are elsewhere). Returns one line.

**Partial-resume.** Single subagent, one output file (`cross-file.md`); interrupted → re-dispatch, discard partial output.

### Phase 3 — Plan synthesis (subagent; then stop, by default)

One subagent reads `notes/` + `cross-file.md` + the rule stack and writes `plan.md` (returns a summary — orchestrator doesn't hold note bodies). On first run the plan is generation `1`; the Phase 4 re-hash rule re-dispatches this phase to produce later generations. **Before regen overwrites `plan.md`, the orchestrator copies the current file to `.deep-simplify.local/plan-g<current-gen>.md`** so the prior plan's content stays addressable by both the regen subagent (for `<applied-list>` content-match) and the orchestrator (for DEFERRED enumeration by file — see Phase 4 re-hash mismatch handling). `plan.md` carries `Generation: <n>` on its second line; the orchestrator records that generation in `progress.md`.

The plan is:

- **Two tracks.** Behavior-preserving (batchable). Behavior-changing — each carries its cited license, `Original purpose:`, `Verified against:`, the announced-change subject, and the guard-test spec; never bundled.
- **Ordered** by the `Scope` + `Symbols` join: `LOCAL` before `MULTI-FILE` touching the same symbols; a cross-file consolidation that `supersedes`/`conflicts with` a per-file item is sequenced first and the superseded item dropped (don't apply a per-file cleanup a later cross-file edit deletes).
- **Batched** with a total count so Phase 4 can show `batch X/Y`.
- **Rule-codification items** listed explicitly: the doc edit + the violation sweep as one item.

**Partial-resume.** Single subagent, one output file (`plan.md`); interrupted → re-dispatch, discard partial output.

**Default: stop here.** `plan.md` is the deliverable; the user reviews it. Phase 4 is opt-in — when the user opts in, record the Phase 4 mode (`default`) in `progress.md` before dispatching. **Override:** the user invokes with "do all" / "don't stop at the plan" → record mode (`do-all`) in `progress.md` and continue into Phase 4 in do-all mode.

### Phase 4 — Apply

**Re-hash a file once per generation, before applying its first item in that generation**, comparing the file's current SHA-256 to the `Hash:` line in its note. On a successful (matching) check, append `- rehashed g<gen> <file>` to `progress.md` (per *Ledger format*) so the "once per generation" optimization survives `/clear` — on resume, skip files with a current-generation `rehashed` line. Skip the check for a file already applied to in the current generation (derive the applied-to file set by mapping current-generation `APPLIED` ledger lines back to file paths via `plan.md`) and for files touched only as cross-file callsites (no Phase 1 note, no `Hash:` to compare): apply changes a file's hash, so re-checking already-touched files would always mis-fire; the anchor-miss check at apply time is the safety net for the remaining items.

Mismatch on that first check → the file changed out-of-band since Phase 1; its note is stale (default scope is files the user is actively editing). Re-run Phase 1 for it, re-run Phase 2 for any cross-file item that cites it, regenerate the plan: **the orchestrator first copies the current `plan.md` to `.deep-simplify.local/plan-g<prev-gen>.md` so the prior plan body stays addressable**, then re-dispatches Phase 3 in regen mode (it increments the plan generation, reads `plan-g<prev-gen>.md` to resolve `<applied-list>` ordinals to content, and omits items that content-match a prior-generation `APPLIED` entry). The orchestrator then reads `plan-g<prev-gen>.md` to enumerate every superseded-generation item that referenced the stale file and writes a `DEFERRED` ledger line for each. Stop the current Phase 4 batch with a one-line note. On resume, the new-generation plan runs from the start of Phase 4 (already excludes applied work, so no anchor-miss storm).

Two modes:

**Default mode (paused walkthrough).** Per batch: header `batch X/Y`; dump the batch's numbered items (one line each, file-labelled) **before asking anything**. Then per item:

- Game-runtime files — `src/**` (incl. `src/phaser/`, `src/tests/`) and `data/**` — pause on every judgment call, options as plain text, free-form answer (no multi-select prompt).
- Carve-out: `dev/**`, `src/editor/**`, `src/static-pages/**` may auto-apply behavior-preserving items.
- Behavior-changing items: show license + `Original purpose:` + `Verified against:` + `Announced change:` + the guard-test spec; on sign-off, apply the edit **and** write the pre-specified guard test in the same step; never bundled.
- Apply behavior-preserving `LOCAL` one at a time per file. For a `MULTI-FILE` set, the orchestrator first dispatches a pre-check subagent that returns "all anchors match" or names the misses; only on full match does the orchestrator apply the set in sequence.
- Anchor miss (LOCAL or `MULTI-FILE` pre-check) → stop and report, triaged per *Anchor miss triage* in the partial-resume section below.
- Mid-`MULTI-FILE` apply failure after pre-check passed (rare — a race) → write `PARTIAL-MULTI-FILE g<gen> #<item-num> <files-mutated>` to `progress.md`, report, stop. Resume refuses to continue until the user manually reverts and writes `MULTI-FILE-CLEARED`.
- One-line recap per item; update `progress.md`; auto-chain to the next batch unless a `VALIDATION-FAILED`, `PARTIAL-MULTI-FILE`, or anchor-miss stop fired.
- Record any item whose `Edit` returned success as `APPLIED` regardless of validation outcome (the file actually changed); on a validation break, write a `VALIDATION-FAILED` marker (per *Ledger format*) to `progress.md` alongside **and stop the run immediately — do not dispatch the next batch**. Report the failing command's output to the user.
- The `VALIDATION-CLEARED` recovery line is written only once the user confirms the fix and the orchestrator has re-run validation and seen it pass. On resume, a `VALIDATION-FAILED` with no `VALIDATION-CLEARED` after it stops the run before doing anything else.

**Partial-resume (default mode).** `progress.md` records each plan item (batch + index + outcome) as it lands. On resume, position advances to the next un-recorded item (no current-generation per-outcome line); never re-process recorded items, including `SKIPPED` and `DEFERRED`. Mid-batch position → finish that batch's remaining un-recorded items before advancing.

**Anchor miss triage.** When an Edit's anchor doesn't match, the orchestrator triages before reporting:

1. **Self-stale from upstream apply.** If the failing file has an `APPLIED` ledger line earlier in the current batch (same run touched the file), the anchor was likely invalidated by an upstream item — signals a Phase 3 plan defect (anchors weren't computed against post-upstream state). Stop and report as `self-stale anchor — plan didn't account for upstream apply`; do not retry. The user re-runs Phase 3 in regen mode (which re-reads the now-applied file's note and re-extracts anchors).
2. **Apply landed before ledger recorded it.** Else if `git diff <file>` shows the planned change is already present in the file, the apply landed and the ledger crashed before the `APPLIED` write — mark `APPLIED`, recap, continue.
3. **External drift.** Else (`git diff` shows the file changed in ways that don't match the planned edit, or the file is unchanged but the anchor still doesn't match): out-of-band drift. Stop and report; the user resolves manually or invokes regen.

**Do-all mode ("do as much as possible, ask me once at the end").** Auto-apply **every behavior-preserving item across the whole scope**, including `src/**` and `data/**`. Every must-own item — every behavior-changing item, every genuine judgment call, every Phase 2 candidate that couldn't be verified, every Phase 5 codification item — is **not applied**. For each, the orchestrator writes the `QUEUED-TO-QUESTIONS g<gen>:#<item-num> qid=q<gen>-<item-num>` ledger line **first**, then appends to `questions.md` a block headed by `Qid: q<gen>-<item-num>` followed by the full decision context (proposal, move, `Scope`, file:anchor, cited license, `Original purpose:`, `Verified against:`, `Announced change:`, the guard-test spec, the concrete options).

Validate the auto-applied set per the project's `AGENTS.md`. Record each auto-applied item as `APPLIED` in the ledger regardless of validation outcome (the file actually changed); on a validation break, write a `VALIDATION-FAILED` marker (per *Ledger format*) alongside **and stop the sweep immediately — no further auto-apply until `VALIDATION-CLEARED` lands**; on resume, a `VALIDATION-FAILED` without `VALIDATION-CLEARED` stops the run until the user confirms the fix.

At the **very end**, present `questions.md` as one batched review — flat numbered list first, then grouped (behavior-changing / codification / unverified), `batch X/Y`. The user answers all at once; as each answer is triaged, record `ANSWERED-APPROVED qid=...` or `ANSWERED-DECLINED qid=...`. Then apply each `ANSWERED-APPROVED` behavior-changing item, writing its pre-specified guard test in the same change, and record `APPLIED-FROM-QUESTIONS qid=...` as it lands; re-validate; recap. Never auto-commit. Report and stop — no downstream git offers.

**Partial-resume (do-all mode).** Same per-item recording in `progress.md` as default mode — both auto-applied items and queue events are checkpointed as they happen, not only at the end. The **ledger-first** order above makes recovery deterministic: on resume, any `QUEUED-TO-QUESTIONS qid=q<g>-<n>` line without a matching `Qid: q<g>-<n>` block in `questions.md` is repaired by re-appending the entry from the corresponding plan item — read it from `plan.md` if `<g>` matches the current generation, else from the preserved `plan-g<g>.md` (no content-match heuristic — the `Qid` is the unique anchor; the entry content is re-derivable from the plan item). Continue auto-applying from the next un-recorded item; accumulated `questions.md` carries forward as-is. The end-of-run batched review fires only after the auto-apply sweep finishes. The review itself resumes by outcome too: re-present only `Qid:` entries whose ledger line is still `QUEUED-TO-QUESTIONS` (an `ANSWERED-APPROVED`/`ANSWERED-DECLINED qid=...` line means it's already triaged); re-apply only `ANSWERED-APPROVED` items that lack an `APPLIED-FROM-QUESTIONS qid=...` line — so a reset during the answer-and-apply end-game never re-asks or double-applies. Regen during the sweep preserves `questions.md` entries as-is (they're qid-anchored, not generation-anchored); their ledger lines also stay valid since the qid format embeds the originating generation.

### Phase 5 — Rule codification

For each rule-codification item: propose the `AGENTS.md` / `structure.md` / `structure-comments.md` / project-`deep-simplify.md` edit **and** the sweep of existing violations as one change (a rule isn't landed until it's written down and the violations are gone). Default mode reviews these inline; do-all mode funnels them through `questions.md`.

## Phase 1 agent prompt template

Replace `<file>` with the assigned source file path, `<N>` with the batch size, and `<repo>` with the absolute path to the project root.

```
Deep-simplify a single file: step back and find where it should be rewritten simpler or clearer, including changes that alter behavior when a project runtime invariant licenses them. One of <N> parallel runs. **Propose only — do not edit the file. Write your analysis to disk.**

Step 1. Read the rule stack in order: `.claude/skills/deep-simplify/deep-simplify.md`, then `<repo>/dev/code-rules/deep-simplify.md` if present (the project license list — if absent, every candidate is behavior-preserving), then `<repo>/AGENTS.md`, then `.claude/skills/review-structure/structure.md`, then `<repo>/dev/code-rules/structure.md` if present (project structure supplement), then `.claude/skills/review-structure/structure-comments.md` (rules for M9 candidates).

Step 2. Compute the SHA-256 of <file> via `shasum -a 256 <file>` and remember it (call this `hash_pre`). Read <file> in full (multiple reads if large — don't truncate). After all reads complete, compute the SHA-256 again (`hash_post`). If `hash_pre` ≠ `hash_post`, the file changed mid-analysis — stop now and return `<file> — UNSTABLE (file changed mid-read)`; the orchestrator re-dispatches once the file settles. If they match, record that hash on the `Hash:` line. For exported symbols, check at least one consumer site.

Step 3. Walk the file. For each mechanism/function/field, ask the Decision questions in deep-simplify.md. Classify every candidate by move (M1–M9) and as behavior-preserving OR behavior-changing.

For a behavior-changing candidate, the note MUST carry all of:
- License: the verbatim runtime invariant from the project list that makes the old behavior unnecessary. None fits → reduce to behavior-preserving or drop. Do not invent a license.
- Original purpose: one sentence from evidence — quote the local comment, else `git blame` the line + `git log -1` the introducing commit and quote that, else "no surviving justification".
- Verified against <file:lines>: the specific code you read that proves the old path is unreachable under that invariant.
- Announced change: one sentence stating what's being replaced and the new mechanism (also serves as the commit subject if applied).
- Guard test: the exact test to write — what it asserts and why it FAILS or materially differs under the OLD behavior.

Missing any of the five → reduce the candidate to a behavior-preserving form or drop it. Do not emit a half-licensed behavior-changing item.

Step 4. Write `.deep-simplify.local/notes/<file>.md` — the note path mirrors <file>'s path under `notes/` with `.md` appended (`mkdir -p` parent dirs as needed). If the note file already exists, stop and report a duplicate-write attempt — do not overwrite.

  # <file> (<line-count> lines)
  Hash: <sha256 of the content you read>
  Purpose: <one paragraph — what this file does>
  ## Candidates
  1. [M<k>] <preserving|changing> | Scope: <LOCAL|MULTI-FILE> | Symbols: <names this touches>
     <one-line proposal>. <why simpler>.
     Anchor: "<short distinctive snippet>"
     (changing only:) License: "<verbatim>"  Original purpose: <…>  Verified against: <file:lines>  Announced change: <…>  Guard test: <…>
     (MULTI-FILE only:) Callsites (<n>): <file>, <file>, …
  ## Cross-file hooks
  - <symbol> duplicates|derives-from|wraps|re-validates <file>:<symbol> — <one line>
  ## Borderline-kept
  - <0–5 close calls and why not proposed>

Step 5. Return EXACTLY one line, nothing else:
`<file> — <n> candidates (<#preserving>/<#changing>), <m> cross-file hooks` (or `<file> — UNSTABLE (file changed mid-read)` per Step 2).

Constraints: conservative — under-propose; a guard for a state the runtime can't reach is what this skill removes, never add one. No edits, no commits — the note file is the only thing you write. Don't restate code; the note is analysis.
```

## Phase 2 agent prompt template

Replace `<repo>` with the absolute path to the project root.

```
Synthesize cross-file simplifications, then verify each at the code. Read the rule stack in order (same as Phase 1): `.claude/skills/deep-simplify/deep-simplify.md`, `<repo>/dev/code-rules/deep-simplify.md` if present, `<repo>/AGENTS.md`, `.claude/skills/review-structure/structure.md`, `<repo>/dev/code-rules/structure.md` if present, `.claude/skills/review-structure/structure-comments.md`. **Propose only.**

Step 1. Read every file in `.deep-simplify.local/notes/` (walk the tree recursively — notes mirror source file paths). Cluster the "Cross-file hooks" into candidate cross-file simplifications (M1/M8 duplicated mechanism; M3 mergeable registries; M2 field derivable across modules; import-direction violations; M5 vocabulary drift; M7 wrapper whose only callers are elsewhere). A single strong hook is a candidate — no minimum-note count.

Step 2. For EACH candidate, verify it against the actual code with targeted `rg` / import-listing / focused reads — "only caller is elsewhere", import-direction, and "these two registries are mergeable" are unprovable from notes and will not typecheck if wrong. Drop or correct candidates the code contradicts. Do not finalize a behavior classification or cite a license from notes alone — ground it against the code you read, or mark the candidate `UNVERIFIED — needs a code decision`.

Step 3. Write `.deep-simplify.local/cross-file.md`: each surviving candidate as one proposal — files + symbols, move, Scope, behavior-preserving vs changing (with License + Verified against if changing), `supersedes`/`conflicts-with` any per-file item, and the order constraint. List `UNVERIFIED` candidates separately.

Step 4. Return one line: `<k> verified, <u> unverified cross-file proposals across <m> files`.
```

## Phase 3 agent prompt template

Replace `<repo>` with the absolute path to the project root, `<gen>` with the plan generation (`1` on first run; the Phase 4 re-hash rule increments on regeneration), and — regeneration only — `<prev-plan-path>` with `.deep-simplify.local/plan-g<prev-gen>.md` (preserved by the orchestrator before regen — see Phase 3 description) and `<applied-list>` with the items the superseded-generation ledger records as `APPLIED` (ordinals `g<prev-gen>:#<num>` that the subagent resolves to proposal content by reading `<prev-plan-path>`).

```
Synthesize the batched simplification plan. Read the rule stack in order (same as Phases 1 and 2): `.claude/skills/deep-simplify/deep-simplify.md`, `<repo>/dev/code-rules/deep-simplify.md` if present, `<repo>/AGENTS.md`, `.claude/skills/review-structure/structure.md`, `<repo>/dev/code-rules/structure.md` if present, `.claude/skills/review-structure/structure-comments.md`. **Propose only — write `plan.md`, do not edit any source file.**

Step 1. Read every file in `.deep-simplify.local/notes/` (walk the tree recursively — notes mirror source paths) and `.deep-simplify.local/cross-file.md`. **Regeneration only:** also read `<prev-plan-path>` to resolve `<applied-list>` ordinals to their proposal content.

Step 2. Build the plan as generation `<gen>`:
- **Two tracks.** Behavior-preserving (batchable). Behavior-changing — each carries its cited license, `Original purpose:`, `Verified against:`, the `Announced change:` subject, and the guard-test spec; never bundled.
- **Ordered** by the `Scope` + `Symbols` join: `LOCAL` before `MULTI-FILE` touching the same symbols; a cross-file consolidation that `supersedes`/`conflicts with` a per-file item is sequenced first and the superseded item dropped. **When a LOCAL item renames or removes a symbol, rewrite downstream items' anchors to use the post-rename text** — otherwise the downstream items anchor-miss against their own batch (the *Anchor miss triage* in Phase 4 flags this as a plan defect).
- **Batched** with a total count so Phase 4 can show `batch X/Y`. Number items `#1`…`#N`. Never bundle a behavior-changing item with other items in the same batch.
- **Rule-codification items** listed explicitly: the doc edit + the violation sweep as one item.
- **Regeneration only:** for each item resolved from `<applied-list>`, content-match it against your new proposals; omit any new proposal whose content matches an already-applied prior item (a re-run Phase 1 note naturally won't re-propose its done items; this clause additionally drops already-applied items from files Phase 1 did *not* re-run).

Step 3. Write `.deep-simplify.local/plan.md` with `Generation: <gen>` on the second line, immediately under the heading.

Step 4. Return a one-paragraph summary: the generation, the item count, the batch count, the preserving/changing split. Do not return the plan body — the orchestrator reads `plan.md` from disk.
```

## Showing code during review

- File-path comment on the first line of every block.
- Signatures and call shape only; bodies elided as `// N lines: <purpose>`.
- Mark `NEW` / `CHANGED — was X` / `unchanged`.
- Post-edit view only for extractions; reflect already-agreed renames.
- Behavior-changing items: additionally show the cited license, `Original purpose:`, `Verified against:`, and the guard-test signature.
- Multi-option judgment calls: short code sample under each option, not just the prompt.

**No rule codes in user-facing text.** Move codes (`M1`–`M9`) and structure-guide cluster codes (`A.1`–`G.1`, `D.1`, `B.7`, etc.) live in the rule files as internal anchors. In any text the user reads — batch headers, item descriptions during pause-for-judgment, trade-off presentations, options, recap lines — translate the code to short plain English. Don't write "this is an M3 centralization" or "M3 (centralize scattered constants)"; write "centralize the scattered `SLOW_TICK = 5` constants". Don't write "Per D.1, this guard…"; write "This guard defends against a state no caller produces". Internal scratch (notes/, plan.md, cross-file.md, progress.md ledger) may keep the codes; user-facing prose must not. When quoting a plan or notes item back to the user, translate before quoting.

## Context management

- **Every analysis pass is a subagent** — Phase 1, 2, 3. The orchestrator holds the index + summaries + `plan.md`, never source files or note bodies. Phase 3 is a subagent specifically so synthesizing 100 notes doesn't re-accumulate in the orchestrator.
- **State on disk.** `notes/` (with per-file hashes on each note's `Hash:` line), `cross-file.md`, `plan.md`, `questions.md`, `progress.md` (mode + rule-stack paths + repo/branch + plan generation + batch ledger + position) are the run. Nothing needed to resume lives only in context.
- **Checkpoint every batch** before starting the next.
- **When context is heavy**, say so plainly and tell the user to `/clear` and re-invoke — the run resumes from `progress.md` + `plan.md` + `notes/` + `questions.md` with no loss. Prefer a subagent over letting context fill; the reset is the fallback, not the plan.

## Per-file gotchas worth flagging when dispatching

- **Performance-tuned code** (rendering, hot loops, caches, throttling, pooling, culling): performance-driven structure looks like over-decomposition. If a comment cites a measurable cost, it stays.
- **Code with preconditions/invariants** (validators, parsers, state machines): a guard whose comment names a real rule it enforces is licensed by that rule, not removable. Removable guards defend against states the runtime can't reach.
- **Files with broad responsibility by design** (manager classes, top-level orchestrators): the project assigns these broad ownership. Size alone isn't a simplification target.
- **Data / content files**: trusted internal input. The simplification is usually M2/M3 (derive, centralize), not extraction. Don't touch displayed-text fields.
- **The boundary, not past it**: the project's single save/validation boundary stays; collapse re-validation behind it, never the boundary check itself.
- **Real change boundaries look like duplication**: a near-duplicate or thin adapter across a testability seam, an error-handling/validation layer, a public API contract, or a data-vs-render / boundary-vs-core split is kept per the rule stack's Keep-signals, not collapsed. Merging two modules that change at different rates couples those rates. When the overlap is incidental and no testability, validation, public-contract, cadence, or AGENTS-boundary explains it, collapse it: a real seam relocates complexity, an accidental one removes it.

## Tuning the batch

- Size-balance batches; ~5 subagents per batch, parallel within, serial across.
- Re-hash a file once per plan generation, before its first applied item, and record `- rehashed g<gen> <file>` in `progress.md` so the optimization survives `/clear` (skip files already applied to in the current generation, and callsite files with no note) — stale → re-run Phase 1 + Phase 2, preserve the prior plan as `plan-g<prev-gen>.md`, and regenerate the plan, per the Phase 4 re-hash rule.
- Validate per `AGENTS.md` after each apply batch; for behavior-changing simulation items the project's economy/trade simulation is the real net, not just typecheck. Report results in plain English.
- A `<new-diagnostics>` / IDE-LSP error surfaced the instant an apply-subagent returns is an **unconfirmed mid-edit snapshot, not ground truth** — a subagent makes hundreds of sequential edits and the LSP routinely indexes a half-applied state (import renamed, call site not yet) that is already consistent in the subagent's final write. Don't act on it on its strength alone: no editing the flagged file, no re-dispatch, no overriding the subagent's recap; and don't spend an extra `typecheck`/`lint` per alarm to disprove it — that defeats the scheduled-validation context policy.
- The **already-scheduled** group-boundary / final gate is the single authoritative check for those diagnostics; only one that survives that scheduled run is real — fix it there, in the fix-loop. "It's free / the harness handed it to me" is not a license to act: a mid-edit snapshot received for free is still mid-edit. (If a real error genuinely can't wait — a later group builds on the suspect file — bring that gate forward to now rather than blind-editing on the snapshot.)
- Commit only when the user asks. Report and stop — no downstream git offers.
