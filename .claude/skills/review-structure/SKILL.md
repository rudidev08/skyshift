---
name: review-structure
description: "[rp] Staged code review via parallel subagents — a structure pass (propose-only, user approves each) then a comment pass that edits the settled post-structure code, per the structure + comments style guides. User-initiated only; don't auto-trigger on mentions."
---

# Review Structure

## Goal

- Two-pass review across the given files: Pass 1 structure (propose-only, user approves each), then Pass 2 comments (edit-in-place on the settled tree).
- Staged so a `[RENAME]`/`[EXTRACT]` that obsoletes a comment is *dropped*, not rewritten — Pass 2 reads already-renamed code.

## Activation

- User-initiated only — via `/review-structure` or an explicit request to review structure + comments using subagents.
- Don't trigger on mentions of `structure.md` / `structure-comments.md`. For one-off edits, edit directly.

## Scope

- Structure + comments only. Test correctness is out of scope.
- Modes (from `$ARGUMENTS` or user wording):
  - *default* — both passes; Pass 1 then Pass 2 on settled files.
  - *structure only* — Pass 1 only; stop after approved edits applied + validated.
  - *comments only* — skip Pass 1; run Pass 2 on files as-is.
- Self-contained orchestration: the run / triage / apply / resume logic lives inline; the two subagent prompt templates live in `agent-prompts.md`, read and sent at dispatch.

## Files to audit

`$ARGUMENTS`. If empty, ask for the file list (or a sample — by directory, size, or domain). Don't pick autonomously. Confirm before dispatching if the list is large or scope is ambiguous.

## Work folder

`.review-structure.local/` at the repo root. The repo's `.gitignore` `*.local/` pattern covers it — check once; add the line only if absent.

- `pass-1/proposals/<slug>.md` — one per file (Pass 1).
- `pass-2/edits/<slug>.md` — one per file (Pass 2). Edits already applied in place; note records the **verbatim original comment text** for every edit so `REVERTED` can restore it after a context reset.
- `progress.md` — resume anchor. Holds mode, scope, resolved rule-stack paths, repo root + branch at start, Pass 1 batch ledger + per-proposal triage + applied-items ledger + validation status, frozen Pass 2 file set + each frozen file's post-Pass-1 baseline SHA, Pass 2 batch ledger + per-edit triage + validation status, position within the current pass. The per-note content hashes live on each note's `Hash:` line (not here); the Pass 2 baseline SHAs do live here, as `pass-2-baseline:` lines.

**Slug rule:** file path with `/`→`__` (double underscore). Dots in the path (including the extension dot) preserved verbatim — `src/foo.ts` → `src__foo.ts`; `src-foo.ts` stays distinct. The orchestrator computes each file's slug once at run start and hands it to the subagent prompts as the `<slug>` placeholder; subagents don't re-derive it.

**Slug collision:** subagent stops + reports if its target note already exists. Orchestrator pre-computes slugs for every file in scope at run start; rejects duplicates upfront.

**Hash:** lowercase hex, digest portion of `shasum -a 256 <file>` (filename stripped). Goes on **line 2** of each per-file note. Pass 1 note hash = pre-apply content the subagent read. Pass 2 note hash = post-edit content.

**Create subtree before writing `progress.md`:** `pass-1/proposals/` + `pass-2/edits/`, with a `.gitkeep` in each so file-listing checks see both subtrees as existing.

### Ledger format

`progress.md` lines follow fixed shapes so the resuming orchestrator parses them consistently.

**Per-outcome lines** (one per item):

- Pass 1 triage: `- p1/<slug>:#<proposal-num> ACCEPTED` or `REJECTED`
- Pass 1 apply (`MULTI-FILE` set opened): `- p1-apply-start/<decl-slug>:#<proposal-num> files:<decl-slug>,<callsite-slug>,…` — written **before** the first edit of a `MULTI-FILE` set, listing every file it touches. Marks the set in-progress until its matching `APPLIED` lands.
- Pass 1 apply: `- p1-apply/<slug>:#<proposal-num> APPLIED` — written when `Edit` returns success (for a `MULTI-FILE` set, after the last edit lands), **before** validation runs.
- Pass 2: `- p2/<slug>:L<line>:<action> KEPT` or `REVERTED` — `<action>` is `REWRITE`/`DEL`/`ADD`, so two edits sharing a line number stay distinct keys.

**Bundle-decision lines** (atomic record of a multi-item accept/reject — one line captures the whole bundle so the decision survives an interrupt):

- Pass 1: `- p1-bundle/<batch-X> ACCEPTED items:<slug>:#N,<slug>:#N,...` or `REJECTED items:...`
- Pass 2: `- p2-bundle/<batch-X> KEPT items:<slug>:L<line>:<action>,...` or `REVERTED items:...`

The bundle line is the **sole record** for the items it lists — resume treats any item in a bundle line as decided with the bundle's outcome. Its `items:` list embeds every `<slug>:#N` / `<slug>:L<line>:<action>` token, so a per-item grep still matches; don't also write per-outcome lines for bundled items. Per-outcome lines are written only for genuinely individual (per-proposal / per-edit) decisions, which have no bundle line. Pass 2 `REVERTED` bundles write the bundle line only after every reverse edit lands.

**Markers:**

- `- VALIDATION-FAILED <pass> batch <X> item <N>` — `<X>` is a batch number, the literal `final` (Pass 1 phase-level gate), or the literal `apply` (Pass 1 mid-apply per-item failure). `<N>` is the item, or `-` for batch/phase-level gates.
- `- VALIDATION-CLEARED <pass> batch <X> item <N>` — written by the resume reconciliation step (under *Run start — resume or fresh*) when the previously-failed validation is re-run and passes. It is the **only** writer of this marker. An unmatched `FAILED` stops resume until reconciliation writes the matching `CLEARED`.
- `- PASS-1-COMPLETE` — written after Pass 1 final validation passes. Authoritative "Pass 1 done" anchor.

**All ledger line prefixes** (at-a-glance index; full semantics above / at first use):

- `p1/<slug>:#N` — Pass 1 per-proposal triage.
- `p1-bundle/<batch-X>` — Pass 1 bundled triage decision (sole record for its items).
- `p1-apply-start/<slug>:#N files:…` — Pass 1 `MULTI-FILE` set opened; in-progress until `APPLIED`.
- `p1-apply/<slug>:#N APPLIED` — Pass 1 edit / `MULTI-FILE` set applied, before validation.
- `p2/<slug>:L<line>:<action>` — Pass 2 per-edit outcome.
- `p2-bundle/<batch-X>` — Pass 2 bundled outcome (sole record for its items).
- `pass-2-baseline:<slug> sha256:<hash>` — post-Pass-1 SHA of a frozen-set file, written at step 7.
- `VALIDATION-FAILED` / `VALIDATION-CLEARED <pass> batch <X> item <N>` — validation gate; `CLEARED` written by resume reconciliation.
- `PASS-1-COMPLETE` — Pass 1 done anchor.

## Workflow

Pass 1 runs to completion (propose → approve → apply → validate) **before** Pass 2 dispatches. Pass 2 reads the post-approval tree as-is.

**Pass 2 file set = requested files ∪ every file an approved Pass 1 proposal actually edited** (callsite/importer files outside the requested set get covered too).

Update `progress.md` as batches dispatch, triage decisions land, applied items finish, and validation completes.

### Run start — resume or fresh

Before resolving scope/mode or starting any work, check `.review-structure.local/` — this read happens **before** any subtree creation, because creating `pass-1/`/`progress.md` first would make the resume check match this run's own fresh files instead of a prior run's.

- **Empty/absent folder.** Fresh run:
  1. Resolve scope and mode (per *Scope* + *Files to audit*).
  2. Pre-compute slugs for every file in scope; reject duplicates.
  3. Create `pass-1/proposals/` + `pass-2/edits/` (with `.gitkeep` in each) before writing `progress.md`.
  4. Write initial `progress.md`: mode + scope + resolved rule-stack paths + repo root + current branch.
  5. Proceed to Pass 1 (or directly to Pass 2 if *comments only*).
- **Non-empty folder, `progress.md` missing/unreadable.** Stop + ask whether to reset; never guess.
- **Non-empty folder, `progress.md` valid.** Read it. Report mode/scope/which pass/where it stopped. Ask **resume** or **reset**. Never silently overwrite.

On resume:

- Saved mode/scope wins. If `$ARGUMENTS` conflict, ask **reset** (start over with new args) or **resume** (ignore them).
- Verify repo root + current branch match what `progress.md` recorded. If either differs, stop + confirm.
- **Reconcile an unmatched `VALIDATION-FAILED`** (a `FAILED` with no later matching `CLEARED`) before any other work. Surface it, then re-run the validation it names — the named batch, the Pass 1 `final` gate, the `apply` per-item check, or the Pass 2 batch — per `AGENTS.md`. If it now passes (the user fixed the tree between sessions), append the matching `VALIDATION-CLEARED <pass> batch <X> item <N>` and continue. If the user instead cleared it by **reverting** the offending edit (the tree no longer contains it), delete that item's `p1-apply/<slug>:#<num> APPLIED` line and flip its triage line to `REJECTED` — so it counts as neither applied nor pending and is not re-applied (the user backed it out deliberately). If validation still fails, stop + report — never resume onto a known-broken tree. This is the only step that writes `VALIDATION-CLEARED`.
- Dispatch only un-completed work per pass (rules below). *Comments only* → resume directly into Pass 2.

### Pass 1 — Structure (propose-only)

1. **Resolve file list and mode.** *Comments only* → skip Pass 1; go to step 7. Pass 2 file set = requested files exactly.

2. **Dispatch one subagent per file in parallel** using the Pass 1 structure prompt from `agent-prompts.md`. Each subagent writes its proposal output (with `Hash:` on line 2) to `pass-1/proposals/<slug>.md` and returns the same output minus the Hash line. Cap at **~5 agents/batch**; >5 files → batch, parallel within, serial across, size-balanced.

3. **Wait for all batches.** Subagents may run typecheck/lint passively to surface pre-existing issues; user reviews proposals, not file health.

4. **Triage and review.** Present proposals grouped by scope and tag, with counts. Substitute real counts/labels:

   ```
   12 structure proposals across 4 files.

   Of those, 5 break repo precedent, grouped by pattern (skip if none break precedent):
     • "*ForManager suffix" — 3 proposals (5, 9, 12)
     • "find*Lowest/find*Highest pair" — 2 proposals (3, 7)

   Review mode?
     1. Per-proposal — review each individually
     2. Bundle by tag — accept whole categories at once (e.g. all [REMOVE] — accept all)
     3. High-stakes only — auto-accept low-risk extractions/removes within a single file,
        review cross-file renames individually, hold file-split sketches for separate discussion
     4. Cluster-pattern proposals: bundle precedent-breaking proposals into one decision; cascade the rest to mode 1
   ```

   Adapt as decisions emerge: once the user rules on a pattern, demote it to bundled accept-all for the rest. After accepting a proposal that changes a duplication/count metric, re-evaluate any pending proposal that cited the original count and flag anything now below its rule's threshold. When a count-changing proposal and a proposal that cited that count would land in the same bundle, triage the count-changer first and re-evaluate the dependent before bundling — don't co-bundle them, or the dependent gets decided before its count is rechecked.

   **Trusted-tree carve-out.** Files under `dev/**`, `src/editor/**`, `src/static-pages/**`: auto-accept `LOCAL` proposals (`[EXTRACT]`/`[INVERT]`/`[REMOVE]`/`[ISOLATE]`/`[PARAMS]`) without individual review. A `MULTI-FILE` set auto-applies only if **every** enumerated callsite/importer is also under those trees; if any lands in `src/**` or `data/**`, triage it individually. `[DECOMPOSE]` stays sketch-only regardless. Game-runtime files (`src/**`, `data/**`) keep per-proposal review. (Matches the project's standing trust boundary: assistant-applied judgment calls are fine in those three trees, never in game runtime or data.)

5. **Apply approved proposals:**
   - **`LOCAL`** — apply via `Edit`, one at a time per file. After each successful `Edit`, **immediately append** `p1-apply/<slug>:#<proposal-num> APPLIED` to `progress.md` **before** running validation (typecheck/lint/test per `AGENTS.md`). Writing APPLIED before validating means a crash between Edit and validation leaves a dirty tree with a matching ledger line — resume reconciles via `git status`/`git diff`. On a new validation failure → stop + report; user recovers manually. Also write `VALIDATION-FAILED p1 batch apply item <proposal-num>`. Unmatched `FAILED` stops resume until `VALIDATION-CLEARED` lands.
   - **`MULTI-FILE`** — Read each target file before editing (callsite/importer files outside the requested set need Read first). **Before the first edit**, append `p1-apply-start/<decl-slug>:#<proposal-num> files:<decl-slug>,<callsite-slug>,…` listing every file the set touches — this marks the set in-progress and lets resume protect (and detect a crash in) all of them, not just the declaration. Apply every edit in order; after the last lands, **immediately** append `p1-apply/<decl-slug>:#<proposal-num> APPLIED` — before validation. Then validate once across **all affected files: declaration plus every callsite/importer touched, including outside the requested set**. Logically atomic (one validation gate over the whole set) but **not crash-atomic** — a crash mid-set leaves a `p1-apply-start` with no matching `APPLIED`; resume catches it (partial-resume step 2). On failure: same `VALIDATION-FAILED p1 batch apply item <proposal-num>` rule.
   - **Apply ordering:** all `LOCAL` (across every file in scope) before any `MULTI-FILE`. A `MULTI-FILE` rename can change an identifier present in another file's `LOCAL` anchor; landing `MULTI-FILE` first anchor-misses. Within a single file's `LOCAL` queue, apply in proposal order — local edits shift line numbers, doing them first keeps later anchors searchable.
   - **`DECOMPOSE`** — not auto-applied. Propose-only sketch is the deliverable; user decides separately.
   - **Anchor miss** — proposal anchor not found at apply → stop + report. Don't substitute or guess.

6. **After all approved Pass 1 edits applied:** run full validation per `AGENTS.md`. On failure, write `VALIDATION-FAILED p1 batch final item -` and stop. On success, write `PASS-1-COMPLETE` — Pass 2 will review this validated tree. **Don't commit.**

**Partial-resume (Pass 1):**

- Step 2 (propose): for each file in scope, dispatch only if `pass-1/proposals/<slug>.md` is missing OR note's `Hash:` doesn't match the file's current SHA-256. **Skip the hash check for any file with a `p1-apply/<slug>:#…` line OR listed in a completed `p1-apply-start/…:#… files:…` set** — its SHA legitimately changed; the note hash represents pre-apply state. (A callsite a `MULTI-FILE` rename touched changed bytes but has no proposal note of its own, or has only rejected proposals — both must skip, not re-dispatch.) **Interrupted `MULTI-FILE` set** (a `p1-apply-start` line with no matching `p1-apply … APPLIED`): stop + surface `git diff` for every file in its `files:` set; don't auto-delete notes or triage. User recovers via git (matches the `LOCAL` and Pass 2 precedents). Stale notes (hash mismatch, no applied items, not in any `p1-apply-start` set) — orchestrator deletes the existing note AND any `p1/<slug>:#…` triage lines for that slug before re-dispatching, so renumbered proposals can't reuse stale triage records and the collision-stop doesn't fire on the re-run. Reuse the rest.
- Step 4 (triage): continue from next un-triaged proposal. Individual decisions persist as per-proposal `ACCEPTED`/`REJECTED` lines; bundle/cluster-pattern decisions persist as a single atomic `p1-bundle/<batch-X> … items:…` line and nothing more (no per-proposal expansion).
- Step 5 (apply):
  - `progress.md` records each applied item with `p1-apply/<slug>:#<proposal-num> APPLIED` — distinct from `ACCEPTED`.
  - Re-hash a file at most **once per session**, before applying its first un-applied item this session: file SHA vs proposal note `Hash:`.
  - Files with prior-session applied items skip this check (anchor-miss is the safety net). Callsite/importer files edited only by `MULTI-FILE` have no proposal note — also skip.
  - Mismatch on first check → stop + report. User decides: re-run Pass 1 for that file (orchestrator first deletes that slug's `p1/<slug>:#…` triage lines, `p1-apply/<slug>:#…` apply lines, and its `pass-1/proposals/<slug>.md` note) or keep approvals with anchor-miss as safety net.
  - `MULTI-FILE` items: the `p1-apply-start … files:…` / `p1-apply … APPLIED` pair brackets the set; an interrupted mid-set (start with no `APPLIED`) is caught in step 2 → stop + surface `git diff` for the set; user recovers via git. (Anchor-miss on an already-replaced anchor is a secondary net.)
  - Anchor miss on a `LOCAL` item the ledger lists as pending may instead mean apply landed before ledger recorded it — `git diff` distinguishes from external drift.
- Step 6 (validate): re-run full validation only if new items applied since the last recorded pass.

*Structure only* mode → stop here.

### Pass 2 — Comments (edit-in-place, on settled files)

7. **Compute Pass 2 scope.** Default/staged: requested files ∪ every file an approved Pass 1 proposal actually edited (incl. callsite/importer files). Comments-only: exactly the requested files. If approved Pass 1 edits fan out widely (heavily-imported symbol renamed), surface the expanded set to the user before freezing so they can confirm or narrow it. **As soon as the user confirms or narrows the set, write it to `progress.md` in a single atomic append** — persists the user's decision before further computation. Then compute slugs. If a slug collision is detected (rare with the `/`→`__` rule, but possible if expansion added a file whose slug collides): Pass 1 already mutated the tree, so the run can't be aborted to re-scope — surface the collision; user picks which colliding file to drop from Pass 2 (separate Pass 2 by hand later). Once persisted + collision-free, the set is **frozen** for the rest of the run (never recomputed on resume). After computing slugs, append each frozen file's current SHA-256 as a baseline line: `pass-2-baseline:<slug> sha256:<hash>` — a second append (the baselines are slug-keyed, so they can't share the set's atomic append). A crash between the set-write and the baseline-write is recovered on resume (partial-resume step 7 rewrites missing baselines).

   Then **dispatch one subagent per file in parallel** using the Pass 2 comments prompt from `agent-prompts.md` over the frozen set — send exactly one opening variant per file (staged vs comments-only, per that file's Pass 1 status), deleting the other. Each writes its edit summary (with `Hash:` line and per-entry `Was-verbatim:` blocks) to `pass-2/edits/<slug>.md` and returns the same output minus Hash line and Was-verbatim blocks. Same batching (~5/batch, parallel within, serial across, size-balanced). Files Pass 1 left untouched are still reviewed.

8. **Run project validation after each batch (including the last)** per `AGENTS.md`. Multi-batch → validate each before dispatching the next; one batch → still validate when it completes. Triage waits until all batches return and final validation passes. On failure → write `VALIDATION-FAILED p2 batch <X> item -` + stop.

9. **Triage and review.** After all batches return + validation passes:

   ```
   N comment changes across M files.
   K tagged [ROUTINE] (style swaps, divider drops, pure-restate deletes)
   L high-stakes ([ADD]/[STALE]/[VOCAB]/[JARGON]/[REVIEW]) + H [HEAVY] files

   Review mode?
     1. Bundle routines (default) — grouped accept-all by category, high-stakes individual
     2. Skip routines — auto-accept routine, only review high-stakes
   ```

   - **High-stakes items**: per-item review with full before/after context. User accepts, rejects, or asks.
   - **Routine bundles** (mode 1): grouped by category ("all 7 style swaps in 3 files — accept all?"); 1-2 representative examples per category, then the rest as a list.
   - **HEAVY files**: 1-2 sample changes per file, then bundle the rest.
   - **Adapt as you go**: once the user rules on a pattern, demote it to `[ROUTINE]` for the remaining batches.

10. **Don't commit until the user explicitly asks.** Mid-workflow commits discouraged. Report Pass 1 + Pass 2 outcomes and stop — no downstream git offers.

**Partial-resume (Pass 2):**

- Step 7 (dispatch): Pass 2 file set is frozen at step 7; never recomputed. **Re-enter step 7 if the frozen set isn't yet in `progress.md` (interrupted before the freeze write), OR if the set is present but any frozen-set slug is missing its `pass-2-baseline:<slug>` line** (interrupted between the set-write and the baseline-write). Re-entry recomputes baselines from the current tree — safe, because Pass 1 is complete and the tree is settled when step 7 runs. For each file in the frozen set, dispatch only if `pass-2/edits/<slug>.md` is missing AND file's current SHA-256 matches its `pass-2-baseline:<slug>` entry. Up-to-date note (Hash matches current SHA) = Pass 2 already ran; skip.
  - **Note missing + file SHA differs from baseline:** prior subagent edited but crashed before writing the note. Stop + surface `git diff` for that slug's file — original comment bytes unrecoverable, re-dispatching is destructive. User rolls back (`git checkout <file>` to post-Pass-1 state) or accepts dirty state and tells orchestrator to skip re-dispatch.
  - **Hash mismatch (note exists but Hash doesn't match file):** stop + surface `git diff`. File changed since note written — manual edit between apply and triage, or other drift. Prior Pass 2 edits already in file; auto-re-dispatching would double-rewrite. Wait for user to roll back + delete stale note, OR accept file as-is and skip re-dispatch. Don't auto-delete the note.
- Step 8 (validate): re-run only if new files completed Pass 2 since last recorded pass.
- Step 9 (triage): continue from next un-triaged edit. Individual outcomes persist as per-edit `KEPT`/`REVERTED` lines; routine-bundle decisions persist as a single atomic `p2-bundle/<batch-X> … items:…` line and nothing more (no per-edit expansion). A `REVERTED` edit is restored from the note's `Was-verbatim:` block; the `REVERTED` line (or bundle line) is written only after every reverse edit lands.

## Showing code during review

Default: file path, function signatures, and call sites only. Bodies stay elided.

- Label every block with the file path on the first line as a comment (e.g. `// src/sim-trade-decision.ts`). Multiple files = multiple labels.
- Show signatures and call shape. Bodies become `// N lines: <one-phrase purpose>` placeholders.
- Mark new vs. unchanged. Every block in a post-edit view labels itself `NEW`, `CHANGED — was X; becomes:`, or `// N lines unchanged: <purpose>`.
- Extractions: one block per file, post-extract view only — not before+after. Renames: callsite line at new name. Inversions: new top-of-function control flow only. Removals: lines being removed, surrounding context only when proposal turns on it.
- Reflect any renames the user already agreed to in surrounding code, even if not yet applied.
- **Multi-option judgment calls: include a short code sample under each option**, not just under the prompt — bodies still elided.

Show body content only when the proposal's evaluation genuinely depends on it, and then only the lines that matter.

**No rule codes in user-facing text.** Cluster codes (`A.1`–`G.1`, `D.1`, `B.3`, `C.3`, etc.) and tag codes (`[EXTRACT]`, `[INVERT]`, `[REMOVE]`, etc.) live in the rule files and subagent output as internal anchors. In user-facing text — batch headers, item descriptions, grouped-bundle summaries, recap lines — translate to short plain English. Don't write "Per D.1, this is a defensive guard" or "[EXTRACT] LOCAL — pull out X"; write "this guard defends against a state no caller produces" / "extract X into a helper". Translate codes before forwarding subagent output. Internal scratch may keep the codes.

## Subagent prompt templates

The Pass 1 (structure) and Pass 2 (comments) subagent prompts live in `.claude/skills/review-structure/agent-prompts.md`. At each dispatch point (Pass 1 step 2, Pass 2 step 7), read the relevant prompt and send it to each subagent, substituting `<file>` / `<slug>` / `<N>` / `<repo>`. Pass 2 has two opening variants (staged when an approved Pass 1 edit changed the file, comments-only otherwise); send exactly one per file and delete the other.

## Context management

- **State on disk.** Per-file proposals (Pass 1) and edits (Pass 2) live under `.review-structure.local/`; `progress.md` holds the ledger and position. Nothing needed to resume lives only in context.
- **A self-report is never the verdict.** A subagent's returned proposal/edit summary is a claim the orchestrator re-checks at apply (anchor match) and validation (typecheck/lint/test), never accepted as-is. The passive typecheck a Pass 1 subagent may run surfaces issues but doesn't gate — the scheduled validation does.
- **Checkpoint as you go.** Append to `progress.md` per batch dispatch, triage decision, applied item, validation pass. Resume reads `progress.md` first.
- **Mandatory `/clear` at the Pass 1 → Pass 2 boundary (default/staged mode).** After Pass 1 final validation passes and `PASS-1-COMPLETE` lands, stop and tell the user to `/clear` + re-invoke. Don't dispatch Pass 2 in the same session as Pass 1 even if context still looks fine. Resumed session reads `progress.md`, sees `PASS-1-COMPLETE`, finds the frozen Pass 2 file set absent, and enters step 7 normally.
- **Target ≤200K per orchestrator session.** Quality drops well before the model's full window fills — anchor on 200K even on 1M-context models. The mandatory boundary `/clear` and the mid-pass reset below are the fallbacks, not the plan.
- **Know when to reset mid-pass.** Within either pass, when orchestrator context is heavy, say so plainly and tell the user to `/clear` + re-invoke — the run resumes from `progress.md` + per-file notes with no loss.

## Scope tags (Pass 1 only)

Comment edits are intra-file — no scope tags. Structure edits:

- **`LOCAL`** — apply one at a time, validate per file. Most `[EXTRACT]`/`[INVERT]`/`[REMOVE]`/`[ISOLATE]`/`[PARAMS]`.
- **`MULTI-FILE`** — must apply atomically (rename in declaration but not callsites breaks typecheck). Most `[RENAME]`/`[SPLIT]`/`[ASYMMETRY]`. Proposing agent enumerates every callsite at proposal time.
- **`DECOMPOSE`** — sketch-only. File splits create files, change exports, rewrite import paths. Not auto-applied; sketch is the deliverable.

Cross-file enumeration via grep/TS-imports is best-effort (blind spots: renamed imports, shared method names, barrel re-exports). Safety net: project typecheck after apply surfaces a missed callsite; agent stops + reports; user re-greps and recovers via editor/git.

## Per-file gotchas worth flagging when dispatching

Same four classes apply to both passes; relevant caution differs by pass:

- **Code with preconditions/invariants** (validators, parsers, state machines, transactional ops): Pass 1 — `[REMOVE]` on a guard: check if comment names a real rule it enforces. Pass 2 — long precondition comments often earn their length; conservative bias critical.
- **Performance-tuned code** (rendering, hot loops, caches, throttling, batched IO, culling): Pass 1 — perf-driven structure can look like over-decomposition; don't propose merging if comment cites a measurable cost. Pass 2 — perf comments often hide non-obvious WHY; preserve unless clearly redundant.
- **Files with broad responsibility by design** (manager-style classes, top-level orchestrators): `AGENTS.md` assigns these broad ownership. Pass 1 — size alone is not justification for `[DECOMPOSE]`; propose only when separable concerns are concrete and split respects cluster naming.
- **Data files** (config, fixtures, content tables, entity definitions): Pass 1 — data, not behavior; don't propose extracting from data declarations or `[DECOMPOSE]`. Pass 2 — `description:`/`label:`/`body:`/`lore:` fields are displayed content, not comments; don't touch them. Pure category-restating dividers (`// Helpers`, `// Refined wares`) should go; dividers carrying grouping info hard to infer from items below stay.
- **Async / event-driven code** (networking, IO, scheduling, queues, lifecycle hooks, cleanup): Pass 2 — Example 4 of the comments guide is the target: concrete-scenario-with-bad-outcome beats internal-mechanism wording. Watch for rewrite candidates.

(Structure supplement `dev/code-rules/structure.md` and comment supplement `dev/code-rules/structure-comments.md` are read unchanged by their respective passes.)

## Tuning the batch

- Size-balance batches — don't put five 1500-line files in one. ~5 subagents/batch, parallel within, serial across.
- A subagent that errors or returns malformed output in-session (either pass; distinct from a valid no-finding return) is re-dispatched once; a second failure surfaces to the user — never silently drop it from the batch.
- Full codebase sweep: many batches at the ~5/batch cap, both passes; budget ~10 min wall-clock per batch.
- After Pass 1's approved edits and after each Pass 2 batch: run validation (typecheck, lint, test) per `AGENTS.md`. Report in plain English. Commit only when the user asks.
- A `<new-diagnostics>` / IDE-LSP error that surfaces the instant an `Edit` lands during a `MULTI-FILE` apply (declaration renamed, a callsite not yet) is an **unconfirmed mid-edit snapshot, not ground truth** — a multi-file rename is neither crash-atomic nor index-atomic, so the LSP routinely indexes the transient half-applied state. Don't edit or re-dispatch the flagged file, and don't bring a `typecheck`/`lint` forward to disprove the alarm.
- The already-scheduled gate is the single authoritative check: the `MULTI-FILE` validation over declaration + every callsite (Pass 1 step 5), the Pass 1 `final` gate, the per-`LOCAL`-item check, or the per-batch Pass 2 validation. Only diagnostics that survive that scheduled run are real — fix them there. If a real error genuinely can't wait (a later item builds on the suspect file), bring that gate forward rather than blind-editing on the snapshot.
