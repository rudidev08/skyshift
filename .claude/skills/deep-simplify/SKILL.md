---
name: deep-simplify
description: "[rp] Deep step-back simplification via staged subagents — per-file notes to disk, cross-file synthesis, then a batched behavior-aware plan; default scope is uncommitted files, plan is the checkpoint"
---

# Deep Simplify

Step back from code and rewrite it simpler or clearer — the larger "this whole mechanism shouldn't exist" / "this complexity defends against a state we can't reach" judgment, not per-rule cleanup. This skill **may change behavior** when a runtime invariant licenses it, and it keeps its working notes **on disk** so a large scope never has to fit in one context window.

What makes this different from per-rule cleanup:

- **Notes live on disk.** Each per-file subagent writes a structured note to a gitignored work folder and returns ≤3 lines. The orchestrator holds an index, never N files of analysis. Phases 2 and 3 are subagents too — the orchestrator never reads source or note bodies.
- **Behavior change is grounded, not asserted.** A behavior-changing proposal must cite a project runtime invariant **and** ground it against the code: an `Original purpose:` line sourced from evidence (local comment, `git blame` + `git log -1`, or "no surviving justification") and a `Verified against: <file:lines>` line citing the specific code that proves the old path is unreachable, plus an announced change and a guard test that fails under the *old* behavior. Missing any → behavior-preserving or dropped.
- **The plan is the deliverable and a hard checkpoint.** Phases 1–3 produce `plan.md` and stop. Execution (Phase 4) is opt-in, so a large run resumes cheaply across context resets.

This skill is **user-initiated**: only run when explicitly invoked (via `/deep-simplify` or a direct request to deep-simplify using subagents). Don't trigger on mentions of `deep-simplify.md` (the rules) — for a one-off simplification, do it directly.

## The rule stack

Every phase — Phase 1 per-file, Phase 2 cross-file, Phase 3 plan — reads the **same** ordered rules so synthesis never classifies with a different rulebook than the per-file agents used:

1. `.claude/skills/deep-simplify/deep-simplify.md` — moves, behavior-change protocol, conservative bias (project-agnostic).
2. `<repo>/dev/code-rules/deep-simplify.md` — the project's runtime-invariant **license list** + worked examples, as additions/overrides.
3. `<repo>/AGENTS.md` (or equivalent conventions file) — project invariants and validation commands.

Record the resolved paths in `progress.md`. **If the project has no `dev/code-rules/deep-simplify.md`, there is no license list — every proposal is behavior-preserving; no behavior-changing simplification is licensed.** Also read `.claude/skills/review-structure/structure.md` (+ project supplement) — a simpler rewrite must still satisfy the shaping rules.

## Files to audit

`$ARGUMENTS`

- **`$ARGUMENTS` given** — use exactly that scope (a folder, a glob, an explicit file list). Confirm before dispatching if it's large or ambiguous.
- **`$ARGUMENTS` empty** — default scope is **all the repo's uncommitted files**: tracked files with working-tree or staged changes plus untracked files (`git status --porcelain`). No folder or file-type filter — `git status` excludes `dist/`, `node_modules/`, and everything else gitignored. Skip only files that aren't readable source text (binary assets). State the resolved list back to the user and let them trim, widen, or redirect before dispatching — that confirmation is the filter, not a hardcoded path rule.

Never hardcode a folder or file type — `src/` / `src/phaser/` / `.ts` are not special, just a scope the user might pass. Don't pick files autonomously beyond the all-uncommitted default. Non-`.ts` files (CSS, HTML, Markdown) are in scope when uncommitted; the runtime-invariant licenses simply won't apply to them, so their candidates come out behavior-preserving. Test files in the uncommitted set are audited like any other file; a behavior-changing item additionally writes/rewrites its guard test as part of apply.

## Work folder

`.deep-simplify.local/` at the repo root. The repo's `.gitignore` `*.local/` pattern covers it — check once; add the line only if that pattern is absent. Layout:

- `notes/<slug>.md` — one per-file note (Phase 1). **Slug** = file path with `/`→`-` and `.`→`-`, extension kept (`src/foo.ts` → `src-foo-ts`). Before writing, if the computed path already exists this run, **stop and report a slug collision** — never overwrite a note (silent overwrite loses a file's analysis with no anchor-miss-style stop).
- `cross-file.md` — cross-file synthesis (Phase 2).
- `plan.md` — the batched, ordered, two-track plan (Phase 3). The durable deliverable.
- `questions.md` — every item that needs a human decision, accumulated with full decision context (Phase 4 "do all" mode).
- `progress.md` — run scope, Phase 4 mode (default vs do-all), resolved rule-stack paths, repo root + branch at start, current `plan.md` generation, batch ledger, phase/batch position. The resume anchor. Per-file hashes live on each note's `Hash:` line, not here.

Two different file paths in the scope must not map to the same slug. The orchestrator pre-computes slugs for every file in scope at run start and rejects duplicates before dispatching any subagent.

### Ledger format

`progress.md` lines follow fixed shapes so the resuming orchestrator parses them consistently. Two kinds of line:

**Per-outcome lines** — one per plan item as it is handled:

- `- plan:g<gen>:#<item-num> <outcome>` — `<gen>` is the plan generation (Phase 3 records `1` when it first writes `plan.md`; a stale-file regeneration increments it). `<outcome>` is one of `APPLIED`, `SKIPPED`, `DEFERRED` (a superseded-generation item, per the Phase 4 re-hash rule), `QUEUED-TO-QUESTIONS` (do-all mode), `ANSWERED-APPROVED` / `ANSWERED-DECLINED` (do-all, recorded as the end-of-run review is triaged), or `APPLIED-FROM-QUESTIONS` (do-all, an approved behavior-changing item applied in the end-of-run pass).

On resume the orchestrator acts only on lines whose `g<gen>` matches the current `plan.md` generation; superseded-generation lines are ignored (kept only as an audit trail). "Un-recorded item" below means an item with no current-generation per-outcome line — `SKIPPED`, `DEFERRED`, and the `QUEUED`/`ANSWERED` states are all recorded, so resume never re-processes them.

**Markers** — batch- or phase-level, not tied to one item:

- `- VALIDATION-FAILED g<gen> batch <X> item <N>` — written when validation breaks during apply. For a phase-level gate use `item -`.
- `- VALIDATION-CLEARED g<gen> batch <X>` — the recovery line. The orchestrator writes it only after the user confirms the break is fixed and validation passes again. A `VALIDATION-FAILED` marker with no `VALIDATION-CLEARED` after it means the run is still broken: resume stops and surfaces it before doing anything else.

## Workflow

Phases are serial. Within a phase, subagents run in parallel, ~5 per batch, serial across batches, size-balanced. After every batch, append to `progress.md` so the run survives a context reset.

### Run start — resume or fresh

Before resolving a new scope or starting any work, check `.deep-simplify.local/`.

- **Empty or absent folder.** Fresh run. Resolve scope (per "Files to audit"), compute slugs for every file in scope and reject duplicates upfront, create the work-folder subtree (`.deep-simplify.local/notes/`) before writing `progress.md`, write the initial `progress.md` (scope + resolved rule-stack paths + repo root + current branch; the Phase 4 mode and plan generation are added later — see Phases 3 and 4), and proceed to Phase 1.
- **Non-empty folder, `progress.md` missing or unreadable.** Stop and ask the user whether to reset; never guess at state.
- **Non-empty folder, `progress.md` valid.** Read it. Report back to the user: the saved scope, the saved Phase 4 mode if Phase 4 was reached, which phase the run was in, which batch within that phase. Ask **resume** or **reset** (wipe and restart). Never silently overwrite a prior run.

On resume:
- The saved scope and Phase 4 mode win. If `$ARGUMENTS` passed alongside conflicts with the saved scope, ask whether the user meant to **reset** (start over with the new scope) or **resume** (ignore the new arguments). A resumed do-all run stays in do-all mode even when the resume invocation omits "do all" — the saved mode is authoritative, not the resume wording.
- Verify the repo root and current branch match what `progress.md` recorded at start. If either differs, stop and confirm — the user may have changed checkouts since the run started.
- If the saved scope was "all uncommitted files" and the working tree has new uncommitted files now, list those new files and ask whether to add them to the resumed scope or hold them for a later run.
- For each phase, dispatch only the work that wasn't already completed — see the per-phase partial-resume rules below.

### Phase 1 — Per-file deep read (parallel subagents, notes to disk)

One subagent per file (template below). Each writes `notes/<slug>.md` with the file's SHA-256 on the second line of the note (`Hash: <sha256>`, immediately under the heading), and returns **only** `<file> — <n> candidates (<#preserving>/<#changing>), <m> cross-file hooks`. The orchestrator never receives the note body. The hash lives in the note so parallel subagents never write to `progress.md` concurrently.

**Partial-resume.** On resume, list the expected slugs from the saved scope. For each slug, dispatch a subagent only if the note is missing OR the note's `Hash:` line doesn't match the file's current SHA-256. For stale notes (hash mismatch), the orchestrator deletes the existing note before re-dispatching so the subagent's collision-stop doesn't fire on the re-run. Completed notes whose hashes still match are reused as-is.

### Phase 2 — Cross-file synthesis (one subagent: notes, then verify at code)

Before dispatching, the orchestrator re-hashes every Phase 1 note's file; on any mismatch, re-runs Phase 1 for that file first (the same rule Phase 4 applies). One subagent reads every `notes/` file + the rule stack, clusters the cross-file hooks into candidates, then **verifies each candidate against the actual code with targeted `rg`/import reads** before writing `cross-file.md`. It does the verifying reads itself (the orchestrator stays flat) and never finalizes a behavior classification or license from notes alone. A single strong hook is a candidate to verify — there is no "≥2 notes" gate (it discards real single-note asymmetric hooks like a wrapper whose only callers are elsewhere). Returns one line.

**Partial-resume.** Single subagent, one output file (`cross-file.md`); if interrupted, re-dispatch and discard any partial output.

### Phase 3 — Plan synthesis (subagent; then stop, by default)

One subagent reads `notes/` + `cross-file.md` + the rule stack and writes `plan.md` (returns a summary — the orchestrator does not hold note bodies). On the first run the plan is generation `1`; the Phase 4 re-hash rule re-dispatches this phase to produce a later generation. `plan.md` carries `Generation: <n>` on its second line, and the orchestrator records that generation in `progress.md`. The plan is:

- **Two tracks.** Behavior-preserving (batchable). Behavior-changing — each carries its cited license, `Original purpose:`, `Verified against:`, the announced-change subject, and the guard-test spec. Behavior-changing items are never bundled.
- **Ordered** by the `Scope` + `Symbols` join: `LOCAL` before `MULTI-FILE` touching the same symbols; a cross-file consolidation that `supersedes` or `conflicts with` a per-file item is sequenced first and the superseded item dropped (don't apply a per-file cleanup a later cross-file edit deletes).
- **Batched** with a total count so Phase 4 can show `batch X/Y`.
- **Rule-codification items** listed explicitly: the doc edit + the violation sweep as one item.

**Partial-resume.** Single subagent, one output file (`plan.md`); if interrupted, re-dispatch and discard any partial output.

**Default: stop here.** `plan.md` is the deliverable; the user reviews it. Phase 4 is opt-in — when the user opts in, record the Phase 4 mode (`default`) in `progress.md` before dispatching. **Override:** if the user invoked with "do all" / "don't stop at the plan", record the mode (`do-all`) in `progress.md` and continue into Phase 4 in do-all mode.

### Phase 4 — Apply

**Re-hash a file once, before applying its first item this session**, comparing the file's current SHA-256 to the `Hash:` line in its note. Skip this check for a file that already had an item applied earlier — this run or a prior session — and for a file edited only as a cross-file callsite (no Phase 1 note of its own, so no `Hash:` to compare): Phase 4's own applies change a file's hash, so re-checking an already-touched file would always mis-fire, and the anchor-miss check at apply time is the safety net for drift in the remaining items.

Mismatch on that first check → the file changed out-of-band since Phase 1; its note is stale (the default scope is files the user is actively editing). Re-run Phase 1 for it, re-run Phase 2 for any cross-file item that cites it, then regenerate the plan: re-dispatch Phase 3 in regen mode (it increments the plan generation and omits items the superseded-generation ledger already records as `APPLIED`). Mark every superseded-generation `plan.md` item that referenced the stale file as `DEFERRED` in `progress.md`, and stop the current Phase 4 batch with a one-line note to the user. On resume the orchestrator runs the new-generation plan from the start of Phase 4 — the regenerated plan already excludes applied work, so there is no anchor-miss storm.

Two modes:

**Default mode (paused walkthrough).** Per batch: header `batch X/Y`; dump the batch's numbered items (one line each, file-labelled) **before asking anything**. Then per item: for game-runtime files — `src/**` (incl. `src/phaser/`) and `data/**` — pause on every judgment call, options as plain text, free-form answer (no multi-select prompt). Carve-out: `dev/**`, `src/editor/**`, `src/static-pages/**` may auto-apply behavior-preserving items. Behavior-changing items are shown with license + `Original purpose:` + `Verified against:` + announced subject; on sign-off, apply the edit **and** write the pre-specified guard test in the same step; never bundled. Apply behavior-preserving `LOCAL` one at a time per file, `MULTI-FILE` sets atomically; on an anchor miss, stop and report. One-line recap per item; update `progress.md`; auto-chain to the next batch. Record any item whose `Edit` returned success as `APPLIED` in the ledger regardless of validation outcome (the file actually changed), and on a validation break write a `VALIDATION-FAILED` marker (format per *Ledger format*) to `progress.md` alongside. On resume, a `VALIDATION-FAILED` marker with no `VALIDATION-CLEARED` after it stops the run — the orchestrator surfaces the broken state, and writes the `VALIDATION-CLEARED` recovery line only once the user confirms the fix and validation passes again.

**Partial-resume (default mode).** `progress.md` records each plan item (batch + index + outcome) as it lands. On resume, the position advances to the next un-recorded item (one with no current-generation per-outcome line — see *Ledger format*); never re-process an item that already has an outcome, including `SKIPPED` and `DEFERRED` ones. If the position sits mid-batch, finish that batch's remaining un-recorded items before advancing. An anchor miss on the first un-recorded item may mean the apply landed before the ledger recorded it — `git diff` distinguishes that from external drift.

**Do-all mode ("do as much as possible, ask me once at the end").** Auto-apply **every behavior-preserving item across the whole scope**, including `src/**` and `data/**`. Every item you must own — every behavior-changing item, every genuine judgment call, every Phase 2 candidate that couldn't be verified, every Phase 5 codification item — is **not applied**; append it to `questions.md` with full decision context: the proposal, move, `Scope`, file:anchor, cited license, `Original purpose:`, `Verified against:`, the guard-test spec, and the concrete options, and record it `QUEUED-TO-QUESTIONS` in the ledger. Validate the auto-applied set per the project's `AGENTS.md`. Record each auto-applied item as `APPLIED` in the ledger regardless of the batch's validation outcome (the files actually changed), and on a validation break write a `VALIDATION-FAILED` marker (format per *Ledger format*) to `progress.md` alongside; on resume, a `VALIDATION-FAILED` marker with no `VALIDATION-CLEARED` after it stops the run until the user confirms the fix. At the **very end**, present `questions.md` as one batched review — flat numbered list first, grouped (behavior-changing / codification / unverified), `batch X/Y`. The user answers all at once; as each answer is triaged, record the item `ANSWERED-APPROVED` or `ANSWERED-DECLINED`. Then apply each `ANSWERED-APPROVED` behavior-changing item, writing its pre-specified guard test in the same change, and record it `APPLIED-FROM-QUESTIONS` as it lands; re-validate; recap. Never auto-commit. Report and stop — no downstream git offers.

**Partial-resume (do-all mode).** Same per-item recording in `progress.md` as default mode — both auto-applied items and `questions.md` appends are checkpointed as they happen, not only at the end. For each must-own item, write the `questions.md` append first, then the `QUEUED-TO-QUESTIONS` ledger line — a crash between them produces a duplicate `questions.md` entry on resume, which the orchestrator detects (by content match with the next un-recorded plan item) and skips re-appending. On resume mid-sweep, continue auto-applying from the next un-recorded item; the accumulated `questions.md` carries forward as-is. The end-of-run batched review fires only after the auto-apply sweep finishes. The review itself resumes by outcome too: on resume the orchestrator re-presents only `questions.md` entries still recorded `QUEUED-TO-QUESTIONS` (an `ANSWERED-APPROVED`/`ANSWERED-DECLINED` line means that one is already triaged), and re-applies only `ANSWERED-APPROVED` items that lack an `APPLIED-FROM-QUESTIONS` line — so a reset during the answer-and-apply end-game never re-asks or double-applies.

### Phase 5 — Rule codification

For each rule-codification item: propose the `AGENTS.md` / `structure.md` / `structure-comments.md` / project-`deep-simplify.md` edit **and** the sweep of existing violations as one change (a rule isn't landed until it's written down and the violations are gone). Default mode reviews these inline; do-all mode funnels them through `questions.md`.

## Phase 1 agent prompt template

Replace `<file>` with the assigned path, `<slug>` with its computed slug, `<N>` with the batch size, and `<repo>` with the absolute path to the project root.

```
Deep-simplify a single file: step back and find where it should be rewritten simpler or clearer, including changes that alter behavior when a project runtime invariant licenses them. One of <N> parallel runs. **Propose only — do not edit the file. Write your analysis to disk.**

Step 1. Read the rule stack in order: `.claude/skills/deep-simplify/deep-simplify.md`, then `<repo>/dev/code-rules/deep-simplify.md` if present (the project license list — if absent, every candidate is behavior-preserving), then `<repo>/AGENTS.md`, then `.claude/skills/review-structure/structure.md`.

Step 2. Read <file> in full (multiple reads if large — don't truncate). Compute the SHA-256 of the content you read (`shasum -a 256 <file>` if the file is unchanged on disk; otherwise hash the bytes you actually read). For exported symbols, check at least one consumer site.

Step 3. Walk the file. For each mechanism/function/field, ask the Decision questions in deep-simplify.md. Classify every candidate by move (M1–M9) and as behavior-preserving OR behavior-changing.

For a behavior-changing candidate, the note MUST carry all of:
- License: the verbatim runtime invariant from the project list that makes the old behavior unnecessary. None fits → reduce to behavior-preserving or drop. Do not invent a license.
- Original purpose: one sentence from evidence — quote the local comment, else `git blame` the line + `git log -1` the introducing commit and quote that, else "no surviving justification".
- Verified against <file:lines>: the specific code you read that proves the old path is unreachable under that invariant.
- Guard test: the exact test to write — what it asserts and why it FAILS or materially differs under the OLD behavior.

Step 4. Write `.deep-simplify.local/notes/<slug>.md` (if that path already exists, stop and report a slug collision — do not overwrite):

  # <file> (<line-count> lines)
  Hash: <sha256 of the content you read>
  Purpose: <one paragraph — what this file does>
  ## Candidates
  1. [M<k>] <preserving|changing> | Scope: <LOCAL|MULTI-FILE> | Symbols: <names this touches>
     <one-line proposal>. <why simpler>.
     Anchor: "<short distinctive snippet>"
     (changing only:) License: "<verbatim>"  Original purpose: <…>  Verified against: <file:lines>  Guard test: <…>
     (MULTI-FILE only:) Callsites (<n>): <file>, <file>, …
  ## Cross-file hooks
  - <symbol> duplicates|derives-from|wraps|re-validates <file>:<symbol> — <one line>
  ## Borderline-kept
  - <0–5 close calls and why not proposed>

Step 5. Return EXACTLY one line, nothing else:
`<file> — <n> candidates (<#preserving>/<#changing>), <m> cross-file hooks`

Constraints: conservative — under-propose; a guard for a state the runtime can't reach is what this skill removes, never add one. No edits, no commits — the note file is the only thing you write. Don't restate code; the note is analysis.
```

## Phase 2 agent prompt template

Replace `<repo>` with the absolute path to the project root.

```
Synthesize cross-file simplifications, then verify each at the code. Read the rule stack (`.claude/skills/deep-simplify/deep-simplify.md`, `<repo>/dev/code-rules/deep-simplify.md` if present, `<repo>/AGENTS.md`). **Propose only.**

Step 1. Read every file in `.deep-simplify.local/notes/`. Cluster the "Cross-file hooks" into candidate cross-file simplifications (M1/M8 duplicated mechanism; M3 mergeable registries; M2 field derivable across modules; import-direction violations; M5 vocabulary drift; M7 wrapper whose only callers are elsewhere). A single strong hook is a candidate — no minimum-note count.

Step 2. For EACH candidate, verify it against the actual code with targeted `rg` / import-listing / focused reads — "only caller is elsewhere", import-direction, and "these two registries are mergeable" are unprovable from notes and will not typecheck if wrong. Drop or correct candidates the code contradicts. Do not finalize a behavior classification or cite a license from notes alone — ground it against the code you read, or mark the candidate `UNVERIFIED — needs a code decision`.

Step 3. Write `.deep-simplify.local/cross-file.md`: each surviving candidate as one proposal — files + symbols, move, Scope, behavior-preserving vs changing (with License + Verified against if changing), `supersedes`/`conflicts-with` any per-file item, and the order constraint. List `UNVERIFIED` candidates separately.

Step 4. Return one line: `<k> verified, <u> unverified cross-file proposals across <m> files`.
```

## Phase 3 agent prompt template

Replace `<repo>` with the absolute path to the project root, `<gen>` with the plan generation (`1` on the first run; the Phase 4 re-hash rule increments it on a regeneration), and — regeneration only — `<applied-list>` with the items the superseded-generation ledger records as `APPLIED`.

```
Synthesize the batched simplification plan. Read the rule stack (`.claude/skills/deep-simplify/deep-simplify.md`, `<repo>/dev/code-rules/deep-simplify.md` if present, `<repo>/AGENTS.md`, `.claude/skills/review-structure/structure.md`). **Propose only — write `plan.md`, do not edit any source file.**

Step 1. Read every file in `.deep-simplify.local/notes/` and `.deep-simplify.local/cross-file.md`.

Step 2. Build the plan as generation `<gen>`:
- **Two tracks.** Behavior-preserving (batchable). Behavior-changing — each carries its cited license, `Original purpose:`, `Verified against:`, the announced-change subject, and the guard-test spec; never bundled.
- **Ordered** by the `Scope` + `Symbols` join: `LOCAL` before `MULTI-FILE` touching the same symbols; a cross-file consolidation that `supersedes`/`conflicts with` a per-file item is sequenced first and the superseded item dropped.
- **Batched** with a total count so Phase 4 can show `batch X/Y`. Number items `#1`…`#N`.
- **Rule-codification items** listed explicitly: the doc edit + the violation sweep as one item.
- **Regeneration only:** omit any item whose simplification `<applied-list>` shows is already applied — a re-run Phase 1 note reflects the current code so a re-read file naturally won't re-propose its done items; this clause additionally drops already-applied items from files Phase 1 did *not* re-run.

Step 3. Write `.deep-simplify.local/plan.md` with `Generation: <gen>` on the second line, immediately under the heading.

Step 4. Return a one-paragraph summary: the generation, the item count, the batch count, the preserving/changing split. Do not return the plan body — the orchestrator reads `plan.md` from disk.
```

## Showing code during review

Show code with discipline: file-path comment on the first line of every block; signatures and call shape only, bodies elided as `// N lines: <purpose>`; mark `NEW` / `CHANGED — was X` / `unchanged`; post-edit view only for extractions; reflect already-agreed renames. For behavior-changing items, additionally show the cited license, `Original purpose:`, and `Verified against:` lines and the guard-test signature. For multi-option judgment calls, put a short code sample under each option, not just the prompt.

**No rule codes in user-facing text.** Move codes (`M1`–`M9`) and structure-guide cluster codes (`A.1`–`G.1`, `D.1`, `B.7`, etc.) live in the rule files as internal anchors. In any text the user reads — batch headers, item descriptions during pause-for-judgment, trade-off presentations, options, recap lines — translate the code to short plain English. Don't write "this is an M3 centralization" or "M3 (centralize scattered constants)"; write "centralize the scattered `SLOW_TICK = 5` constants". Don't write "Per D.1, this guard…"; write "This guard defends against a state no caller produces". Internal scratch (notes/, plan.md, cross-file.md, progress.md ledger) may keep the codes; user-facing prose must not. When quoting a plan or notes item back to the user, translate before quoting.

## Context management

The disk-notes architecture exists so the orchestrator stays flat. Hold to it:

- **Every analysis pass is a subagent** — Phase 1, Phase 2, and Phase 3. The orchestrator holds the index + summaries + `plan.md`, never source files or note bodies. Phase 3 is a subagent specifically so synthesizing 100 notes doesn't re-accumulate in the orchestrator.
- **State is on disk.** `notes/` (with per-file hashes on each note's `Hash:` line), `cross-file.md`, `plan.md`, `questions.md`, `progress.md` (mode + rule-stack paths + repo/branch + plan generation + batch ledger + position) are the run. Nothing needed to resume lives only in context.
- **Checkpoint every batch** before starting the next.
- **Know when to reset.** When the orchestrator's context is heavy, say so plainly and tell the user to `/clear` and re-invoke — the run resumes from `progress.md` + `plan.md` + `notes/` + `questions.md` with no loss. Prefer reaching for a subagent over letting context fill; the reset is the fallback, not the plan.

## Why grounded licensing

Per-rule structure review forbids behavior change because a bad parallel batch could land subtle regressions before the user sees them. This skill needs behavior change but keeps the same safety by *proving* it: `Original purpose:` must be sourced from evidence (not invented) for every `[REMOVE]`-style deletion; `Verified against: <file:lines>` must cite the specific code that proves the old path is unreachable. The documented failure mode of unverified rewrites is **sharpening** — a vague justification hardens into a specific false claim through paraphrase. A behavior-changing proposal here carries both, plus a cited project invariant, an announced change, and a guard test that fails under the *old* behavior. A self-certified invariant name is not enough — the license is grounded against the code or the change is dropped.

## Why disk-notes

A deep step-back read of a file is far longer than a structural proposal list; keeping proposals in the orchestrator's context is impossible at scale. Notes to disk + ≤3-line returns keep the orchestrator flat regardless of scope, make Phase 2/3 cheap (they read distilled notes, not code, as subagents), and make `plan.md` durable across a context reset.

## Why questions.md

Do-all mode exists because the user wants a large run to do the maximum unattended while still owning every behavior change. Inline pausing on a `src/`+`data/`-heavy scope would interrupt on nearly every item. Accumulating every must-own decision into `questions.md` with full context and asking them in one end-of-run batch separates "work the skill can do" from "decisions the user must make" — the skill runs to completion, the user answers once, the approved behavior changes apply last with their guard tests.

## Per-file gotchas worth flagging when dispatching

- **Performance-tuned code** (rendering, hot loops, caches, throttling, pooling, culling): performance-driven structure looks like over-decomposition. If a comment cites a measurable cost, it stays.
- **Code with preconditions/invariants** (validators, parsers, state machines): a guard whose comment names a real rule it enforces is licensed by that rule, not removable. Removable guards defend against states the runtime can't reach.
- **Files with broad responsibility by design** (manager classes, top-level orchestrators): the project assigns these broad ownership. Size alone isn't a simplification target.
- **Data / content files**: trusted internal input. The simplification is usually M2/M3 (derive, centralize), not extraction. Don't touch displayed-text fields.
- **The boundary, not past it**: the project's single save/validation boundary stays; collapse re-validation behind it, never the boundary check itself.
- **Real change boundaries look like duplication**: a near-duplicate or thin adapter across a testability seam, an error-handling/validation layer, a public API contract, or a data-vs-render / boundary-vs-core split is kept per the rule stack's Keep-signals, not collapsed. Merging two modules that change at different rates couples those rates. When the overlap is incidental and no testability, validation, public-contract, cadence, or AGENTS-boundary explains it, collapse it: a real seam relocates complexity, an accidental one removes it.

## Tuning the batch

- Size-balance batches; ~5 subagents per batch, parallel within, serial across.
- Re-hash a file once, before its first applied item this session (skip files already applied to, and callsite files with no note) — stale → re-run Phase 1 + Phase 2 and regenerate the plan, per the Phase 4 re-hash rule.
- Validate per `AGENTS.md` after each apply batch; for behavior-changing simulation items the project's economy/trade simulation is the real net, not just typecheck. Report results in plain English.
- **A `<new-diagnostics>` / IDE-LSP error surfaced the instant an apply-subagent returns is an unconfirmed mid-edit snapshot, not ground truth** — a subagent makes hundreds of sequential edits and the LSP routinely indexes a half-applied state (import renamed, call site not yet) that is already consistent in the subagent's final write. Don't act on it on its strength alone: no editing the flagged file, no re-dispatch, no overriding the subagent's recap; and don't spend an extra `typecheck`/`lint` to disprove it per alarm — that defeats the scheduled-validation context policy.
- The **already-scheduled** group-boundary / final gate is the single authoritative check for those diagnostics; only one that survives that scheduled run is real — fix it there, in the fix-loop. "It's free / the harness handed it to me" is not a license to act: a mid-edit snapshot received for free is still mid-edit; free-to-receive ≠ true. (If a real error genuinely can't wait — a later group builds on the suspect file — bring that gate forward to now rather than blind-editing on the snapshot.)
- Commit only when the user asks. Report and stop — no downstream git offers.
