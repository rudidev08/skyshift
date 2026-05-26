---
name: review-structure
description: "[rp] Staged code review via parallel subagents — a structure pass (propose-only, user approves each) then a comment pass that edits the settled post-structure code, per the structure + comments style guides"
---

# Review Structure

## Goal

- Two-pass review across files passed in: Pass 1 structure (propose-only, user approves each); Pass 2 comments (edit-in-place on the settled post-structure tree).
- Staged because a `[RENAME]`/`[EXTRACT]` that obsoletes a comment must be *dropped* not rewritten — Pass 2 reads already-renamed code; one skill can coordinate that, two cannot.

## Activation

- User-initiated only — via `/review-structure` or an explicit request to review structure and comments using subagents.
- Don't trigger on mentions of `structure.md` / `structure-comments.md` (the rules); for one-off edits, edit directly.

## Scope

- Structure + comments only. Test correctness is out of scope.
- Mode (from `$ARGUMENTS` or user wording):
  - *default* — both passes: Pass 1, then Pass 2 on the settled files.
  - *structure only* — Pass 1 only; stop after approved structural edits are applied and validated.
  - *comments only* — skip Pass 1; run Pass 2 on files as-is.
- Self-contained: this skill carries the full orchestration scaffolding for both passes inline.

## Files to audit

`$ARGUMENTS`. If empty, ask the user for the file list (or a sample — by directory, size, or domain). Don't pick autonomously. Confirm before dispatching if the list is large or scope ambiguous.

## Work folder

`.review-structure.local/` at the repo root. The repo's `.gitignore` `*.local/` pattern covers it — check once; add the line only if that pattern is absent.

- `pass-1/proposals/<slug>.md` — one per file (Pass 1). **Slug** = file path with `/`→`__` (double underscore). Dots in the original path (including the extension dot) are preserved verbatim, so `src/foo.ts` → `src__foo.ts` while a sibling `src-foo.ts` → `src-foo.ts` stays distinct (the old `.`→`-` rule collided these). Subagent writes its proposal output here with `Hash: <sha256 of the content it read>` on the second line under the heading. If the path already exists this run, **stop and report a slug collision** — never overwrite.
- `pass-2/edits/<slug>.md` — one per file (Pass 2). Same slug rule. `Hash: <sha256 of the file's post-edit content>` on the second line (so partial-resume can detect a manual edit between apply and triage). Edits are already applied in place; for every edit the note records the **verbatim original comment text** so a `REVERTED` triage decision can restore it exactly after a context reset. Same collision stop.
- `progress.md` — resume anchor. Mode, scope, resolved rule-stack paths, repo root + branch at start, Pass 1 batch ledger + per-proposal triage outcomes + applied-items ledger + validation status, frozen Pass 2 file set, Pass 2 batch ledger + per-edit triage outcomes + validation status, position within the current pass. Per-file hashes live on each note's `Hash:` line, not here.

Two file paths in scope must not map to the same slug. The orchestrator pre-computes slugs for every file in scope at run start and rejects duplicates before dispatching.

Hash format: lowercase hex, the digest portion of `shasum -a 256 <file>` (filename stripped). Both orchestrator and subagents use this format so the equality checks in partial-resume work.

### Ledger format

`progress.md` lines follow fixed shapes so the resuming orchestrator parses them consistently.

**Per-outcome lines** — one per item as handled:

- Pass 1 triage: `- p1/<slug>:#<proposal-num> ACCEPTED` or `REJECTED`
- Pass 1 apply: `- p1-apply/<slug>:#<proposal-num> APPLIED` — written when the `Edit` returns success; separate from the `ACCEPTED` line so resume distinguishes accepted-but-not-yet-applied from applied.
- Pass 2: `- p2/<slug>:L<line> KEPT` or `REVERTED`

Each per-outcome line carries a tag (`p1/`, `p1-apply/`, `p2/`), the file slug, the item identifier (proposal number for Pass 1, line number for Pass 2), and the outcome word.

**Bundle-decision lines** — single-line atomic record of a multi-item accept/reject bundle, written **before** any per-outcome expansion so the user's whole-bundle decision survives an interrupt mid-expansion:

- Pass 1: `- p1-bundle/<batch-X> ACCEPTED items:<slug>:#N,<slug>:#N,...` or `REJECTED items:...`
- Pass 2: `- p2-bundle/<batch-X> KEPT items:<slug>:L<line>,...` or `REVERTED items:...`

The `items:` list spells out every covered proposal (Pass 1) or edit (Pass 2). Resume parser treats any item that appears in a bundle line as decided with the bundle's outcome, even if its per-outcome line is missing. After the bundle line lands the orchestrator MAY append the per-outcome lines for grep convenience, but they are derived — the bundle line is authoritative. (Pass 2 `REVERTED` bundles still write the bundle line only after every reverse edit lands, same rule as the per-edit `REVERTED` line — so the ledger never claims a revert that didn't happen.)

**Markers** — batch- or phase-level, not tied to one item:

- `- VALIDATION-FAILED <pass> batch <X> item <N>` — validation broke. `<X>` is either a dispatch batch number (Pass 2 between-batch gate), the literal `final` (Pass 1 phase-level gate), or the literal `apply` (Pass 1 mid-apply per-item failure during step 5). `<N>` is the proposal/item number, or `-` for batch- and phase-level gates that don't tie to a specific item.
- `- VALIDATION-CLEARED <pass> batch <X> item <N>` — recovery; written only after the user confirms the break is fixed and validation passes again. `<N>` matches the item from the `VALIDATION-FAILED` line being cleared (or `-` for phase-level gates). A `VALIDATION-FAILED <pass> batch <X> item <N>` with no matching `VALIDATION-CLEARED <pass> batch <X> item <N>` after it = run still broken: resume stops and surfaces it before doing anything else. Multiple failures in the same pass+batch each need their own paired clear.

## Workflow

Pass 1 runs to completion (propose → approve → apply → validate) **before** Pass 2 dispatches. Pass 2 reads the post-approval tree as-is — no cross-pass dependency edges.

**Pass 2 file set = the requested files ∪ every file an approved Pass 1 proposal actually edited.** Approved `MULTI-FILE` `[RENAME]`/`[SPLIT]` edits stale comments in callsite/importer files outside the requested set; Pass 2 must cover them too.

Throughout both passes, update `progress.md` as batches dispatch, triage decisions land, applied items finish, and validation completes — so the run survives a context reset and can resume from disk.

### Run start — resume or fresh

Before resolving a new scope or mode or starting any work, check `.review-structure.local/`.

- **Empty/absent folder.** Fresh run:
  - Resolve scope and mode (per *Scope* + *Files to audit*).
  - Pre-compute slugs for every file in scope; reject duplicates upfront.
  - Create the work-folder subtree (`pass-1/proposals/` + `pass-2/edits/`) before writing `progress.md`.
  - Write initial `progress.md`: mode + scope + resolved rule-stack paths + repo root + current branch.
  - Proceed to Pass 1 (or directly to Pass 2 if *comments only*).
- **Non-empty folder, `progress.md` missing/unreadable.** Stop and ask the user whether to reset; never guess.
- **Non-empty folder, `progress.md` valid.** Read it. Report to the user: saved mode, scope, which pass the run was in, and where it stopped (proposing, awaiting triage, applying mid-file, validating, or partway through Pass 2). Ask **resume** or **reset** (wipe and restart). Never silently overwrite a prior run.

On resume:

- Saved mode/scope wins. If `$ARGUMENTS` passed alongside the resume conflict with the saved mode/scope, ask whether the user meant **reset** (start over with the new arguments) or **resume** (ignore them).
- Verify the repo root + current branch match what `progress.md` recorded at start. If either differs, stop and confirm — the user may have changed checkouts.
- For each pass, dispatch only un-completed work (see per-pass partial-resume rules below). *Comments only* mode → no Pass 1 state was ever written; resume directly into Pass 2.

### Pass 1 — Structure (propose-only)

1. **Resolve file list and mode.** *Comments only* → skip Pass 1 entirely; go to step 7. Pass 2 file set = requested files exactly (no Pass 1 edits happened).

2. **Dispatch one subagent per file in parallel** using the Pass 1 prompt template. Each subagent writes its proposal output (with `Hash:` line on the second line) to `pass-1/proposals/<slug>.md` and returns the same output minus the Hash line as response. Cap each batch at **~5 agents** (large files take 2-3× longer; oversized batches stall on tail agents). >5 files → batch, parallel within, serial across, size-balanced.

3. **Wait for all batches.** Propose doesn't gate on validation; subagents may run project typecheck/lint passively to surface pre-existing issues, but the user is reviewing proposals, not signing off on file health.

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

   Adapt as decisions emerge: once the user rules on a pattern, demote it to bundled accept-all for the rest. After accepting a proposal that changes a duplication/count metric, re-evaluate any pending proposal that cited the original count and flag anything now below its rule's threshold.

5. **Apply approved proposals (by scope):**
   - **`LOCAL`** — apply via `Edit`, one at a time per file. **Write the ledger line before running validation:** after each successful `Edit`, immediately append `p1-apply/<slug>:#<proposal-num> APPLIED` (the file actually changed) to `progress.md`, then run project validation (typecheck, lint, test per `AGENTS.md`). Writing APPLIED before validating means a crash between Edit and validation leaves a dirty tree with a matching ledger line — resume reconciles via `git status` / `git diff`, never silently re-applying the same edit and consuming the anchor twice. On a new validation failure → stop and report; user recovers manually (skill does not manage rollback). Additionally write a `VALIDATION-FAILED p1 batch apply item <proposal-num>` marker (format per *Ledger format*). On resume, `VALIDATION-FAILED <pass> batch <X> item <N>` with no matching `VALIDATION-CLEARED <pass> batch <X> item <N>` after it stops the run — orchestrator surfaces broken state, writes the matching `VALIDATION-CLEARED` only after the user confirms the fix and validation passes.
   - **`MULTI-FILE`** — Read each target file before editing (callsite/importer files outside the requested set won't have been read yet — Edit needs a prior Read). Apply every edit in order; **immediately** record the set with one `p1-apply/<slug>:#<proposal-num> APPLIED` line keyed to the declaration's slug (the proposal lives there; callsites have no proposal note of their own) — write this before validation, same atomicity reasoning as LOCAL. Then validate once across **all affected files: declaration plus every callsite/importer touched, including outside the requested set**. Atomic by definition (a rename needs every callsite to land together). On a new validation failure: stop and report; write a `VALIDATION-FAILED p1 batch apply item <proposal-num>` marker; resume stops until the matching `VALIDATION-CLEARED`.
   - **Apply ordering across the batch:** all `LOCAL` proposals (across every file in scope) apply before any `MULTI-FILE` proposal. A `MULTI-FILE` rename changes an identifier that may appear in another file's `LOCAL` anchor; if `MULTI-FILE` lands first, that other file's `LOCAL` anchor-misses on the renamed token. Within a single file's `LOCAL` queue, apply in proposal order — local edits shift line numbers; doing them first keeps later anchors searchable.
   - **`DECOMPOSE`** — not auto-applied. Propose-only sketch (target files, moved symbols, import-path changes) is the deliverable; user decides separately.
   - **Anchor miss** — proposal anchor not found at apply → stop and report. Don't substitute or guess.

6. **After all approved Pass 1 edits applied:** run full validation per `AGENTS.md`. On failure, write `VALIDATION-FAILED p1 batch final item -` to `progress.md` and stop — resume surfaces the broken state before Pass 2 dispatches. On success the tree is settled — this validated state is exactly what Pass 2 reviews. **Don't commit.**

**Partial-resume (Pass 1):**

- Step 2 (propose): for each file in scope, dispatch a subagent only if `pass-1/proposals/<slug>.md` is missing OR the note's `Hash:` doesn't match the file's current SHA-256. **Skip the hash check for any file with a `p1-apply/<slug>:#…` line in `progress.md`** — the file's SHA has legitimately changed from a prior apply, and the note's hash represents the pre-apply state. Stale notes (hash mismatch on files without applied items) — orchestrator deletes the existing note AND any `p1/<slug>:#…` triage lines for that slug from `progress.md` before re-dispatching, so the renumbered proposals can't reuse stale triage records and the subagent's collision-stop doesn't fire on the re-run. Reuse the rest.
- Step 4 (triage): continue from the next un-triaged proposal. Triage decisions persisted as per-proposal outcomes (`ACCEPTED`/`REJECTED`); bundled and cluster-pattern decisions are written first as a single atomic `p1-bundle/<batch-X> ... items:...` line capturing the user's whole-bundle decision (per *Ledger format*), then optionally expanded to per-proposal outcomes. Resume treats any proposal covered by a bundle line as decided regardless of whether the per-proposal lines were written — so an interrupt mid-expansion never re-asks the user about a bundle they already decided.
- Step 5 (apply):
  - `progress.md` records each applied item with `p1-apply/<slug>:#<proposal-num> APPLIED` — separate from `ACCEPTED` so resume distinguishes accepted-but-not-applied from applied.
  - Re-hash a file at most **once per session**, before applying its first un-applied item this session: compare file's current SHA-256 to proposal note's `Hash:`.
  - Files with prior-session applied items skip this check (anchor-miss at apply time catches drift in remaining items). Callsite/importer files edited only by `MULTI-FILE` have no proposal note and no `Hash:` to compare — also skip; anchor-miss is the safety net.
  - Mismatch on the first check → stop and report: file changed since propose step. User decides: re-run Pass 1 for that file (orchestrator first deletes that slug's `p1/<slug>:#…` triage lines, `p1-apply/<slug>:#…` apply lines, and its `pass-1/proposals/<slug>.md` note so stale approvals/applies can't carry forward to renumbered proposals) or keep approvals with anchor-miss as the safety net.
  - `MULTI-FILE` items recorded as one apply event; interrupted mid-set apply caught on resume by anchor-miss on already-replaced anchors → stop and report; user recovers via git.
  - Anchor miss on a `LOCAL` item the ledger lists as pending may instead mean the apply landed before the ledger recorded it — `git diff` distinguishes from external drift.
- Step 6 (validate): re-run full validation only if new items have been applied since the last recorded validation pass.

*Structure only* mode → stop here.

### Pass 2 — Comments (edit-in-place, on settled files)

7. **Compute Pass 2 scope.** Default/staged runs: requested files ∪ every file an approved Pass 1 proposal actually edited (including callsite/importer files a `MULTI-FILE` edit touched). Comments-only runs: exactly the requested files. If an approved Pass 1 edit fans out widely (heavily-imported symbol renamed), surface the expanded set to the user before freezing so they can confirm or narrow it (e.g. to just rename-staled comments in extras), per the same "confirm if large" rule in *Files to audit*. **As soon as the user confirms or narrows the set, write it to `progress.md` in a single atomic append** — this persists the user's narrowing decision before any further computation, so an interrupt between user confirmation and freeze doesn't lose that decision. Then compute slugs for the persisted set. If a slug collision is detected (rare with the `/`→`__` slug rule, but possible if expansion added a file whose slug collides with an in-scope file): Pass 1 has already mutated the tree, so the run can't be aborted to re-scope — surface the collision and the user picks which colliding file to drop from Pass 2 (they can run a separate Pass 2 on it later by hand). The drop decision updates the persisted set atomically. Once the set is persisted and slug-collision-free, it's **frozen** for the rest of the run (never recomputed on resume).

   Then **dispatch one subagent per file in parallel** using the Pass 2 prompt template over the frozen set. Each writes its edit summary (with `Hash:` line and per-entry `Was-verbatim:` blocks) to `pass-2/edits/<slug>.md` and returns the same output minus the Hash line and Was-verbatim blocks as response. Same batching discipline (~5/batch, parallel within, serial across, size-balanced). Files Pass 1 left untouched are reviewed too — a file with zero structural proposals still gets its comments reviewed.

8. **Run project validation after each batch (including the last)** per `AGENTS.md`. Multiple batches → validate each before dispatching the next; one batch → still validate once it completes. Triage waits until all batches return and the final validation passes. On failure → write `VALIDATION-FAILED p2 batch <X> item -` to `progress.md` and stop — resume surfaces the broken state before continuing.

9. **Triage and review.** After all batches return + validation passes:

   ```
   N comment changes across M files.
   K tagged [ROUTINE] (style swaps, divider drops, pure-restate deletes)
   L high-stakes ([ADD]/[STALE]/[VOCAB]/[JARGON]) + H [HEAVY] files

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

- Step 7 (dispatch): the Pass 2 file set is frozen at step 7 and never recomputed on resume. (If the file set isn't yet in `progress.md` — orchestrator was interrupted during step 7 before the freeze write — re-enter step 7 normally to compute it.) For each file in the frozen set, dispatch only if `pass-2/edits/<slug>.md` is missing. Existence of an up-to-date edit note (Hash matches the file's current SHA-256) = that file's Pass 2 already ran; skip re-dispatch. **Hash mismatch (note exists but Hash doesn't match the file):** stop and surface `git diff` for that slug's file to the user. The file has changed since the note was written — either (a) a manual edit between Pass 2 apply and triage, (b) a mid-edit subagent interruption that left partial edits without `Was-verbatim:` records, or (c) some other unexpected drift. In every case the prior Pass 2 edits are already in the file; auto-re-dispatching would let a new subagent edit on top of edits that have no triage record, double-rewriting comments. Wait for the user to roll back the file to a clean pre-Pass-2 state (and delete the stale note) before re-dispatching, OR accept the file as-is and skip re-dispatch for that slug. Don't auto-delete the note — that decision is the user's.
- Step 8 (validate): re-run only if new files have completed Pass 2 since the last recorded validation pass.
- Step 9 (triage): continue from the next un-triaged edit. Outcomes persisted as `KEPT`/`REVERTED`; routine-bundle rules are written first as a single atomic `p2-bundle/<batch-X> ... items:...` line capturing the user's whole-bundle decision (per *Ledger format*), then optionally expanded to per-edit outcomes. Resume treats any edit covered by a bundle line as decided regardless of whether the per-edit lines were written. A `REVERTED` edit is restored from the note's `Was-verbatim:` block; the `REVERTED` line (or bundle line) is written only after every reverse edit lands — so the ledger never claims a revert that didn't happen.

## Showing code during review

Default: file path, function signatures, and call sites only. Bodies stay elided. The user has the file open — pasted statements that aren't moving are noise.

- Label every block with the file path on the first line as a comment (e.g. `// src/sim-trade-decision.ts`). Multiple files = multiple labels.
- Show signatures and the call shape. Bodies become `// N lines: <one-phrase purpose>` placeholders — never restate statements that aren't moving.
- Mark new vs. unchanged. Every block in a post-edit view labels itself `NEW`, `CHANGED — was X; becomes:`, or `// N lines unchanged: <purpose>`.
- Extractions: one block per file, the post-extract view only — not before+after. Renames: the callsite line at the new name. Inversions: the new top-of-function control flow only. Removals: the lines being removed, surrounding context only when the proposal turns on it.
- Reflect any renames the user already agreed to in the surrounding code, even if not yet applied.
- **Multi-option judgment calls: include a short code sample under each option**, not just under the prompt — bodies still elided. Reading three labeled bullets without seeing the resulting code forces mental simulation; show the diff between options.

Show body content only when the proposal's evaluation genuinely depends on it, and then only the lines that matter.

**No rule codes in user-facing text.** Cluster codes (`A.1`–`G.1`, `D.1`, `B.3`, `C.3`, etc.) and tag codes (`[EXTRACT]`, `[INVERT]`, `[REMOVE]`, etc.) live in the rule files and subagent output as internal anchors. In any text the user reads — batch headers, item descriptions during high-stakes review, grouped-bundle summaries, recap lines — translate the code to short plain English. Don't write "Per D.1, this is a defensive guard" or "Cluster D.1 (don't write what isn't needed) hits"; write "this guard defends against a state no caller produces". Don't write "[EXTRACT] LOCAL — pull out X"; write "extract X into a helper". When forwarding subagent output to the user, translate the codes before forwarding. Internal scratch (intermediate notes, orchestrator bookkeeping) may keep the codes; user-facing prose must not.

## Pass 1 agent prompt template (structure — propose only)

Send this to each Pass 1 subagent. Replace `<file>` with the assigned path, `<N>` with the batch size, and `<repo>` with the absolute path to the project root.

```
Apply the project's code structure guide to a single file. This is one of <N> parallel agent runs in a controlled review — be careful, conservative, explicit. **This is the propose step — do not edit the file in this run.**

Step 1. Read `.claude/skills/review-structure/structure.md` in full. The 29 rules across 7 clusters cover function size/decomposition, control flow/nesting, naming, code that doesn't need to exist, layout, side effects, and file size as a signal. Then read `<repo>/AGENTS.md` (or equivalent conventions file) in full — it carries project-specific reserved/rejected vocabulary, preferred patterns, cluster/import boundaries, and file-naming conventions the universal rules defer to. Then check for `dev/code-rules/structure.md` at the project root; if present, read it as additions/overrides — including project-specific file-pattern guidance.

Step 2. Read <file> in full (multiple reads if large — don't truncate). Compute the SHA-256 of the content you read (`shasum -a 256 <file>` if the file is unchanged on disk; otherwise hash the bytes you actually read).

Step 3. Walk the file and evaluate each function, scope, and structural pattern against the rules:
- **Function size/decomposition (A):** too long; multiple unrelated jobs; a block needing a `// what` comment; bool flag arg changing behavior; 4+ params.
- **Control flow/nesting (B):** >2-3 nesting levels; missing guard clauses; `else` after `return`/`throw`; accumulating `let result` instead of early return; init-then-do for our own APIs (framework lifecycle exempt).
- **Naming (C):** acronyms/shortenings; a rename would replace a comment; precedent ignored; asymmetric paired operations; mutation hidden in a non-mutating name; exported-shape field names that escape across files. For helpers extracted from a branch or relationship, name from the real-world scenario that fires the branch (`restoreSavedGame`, not `applySnapshotPath`) **or the purpose of the relationship** (`mirrorSimEntitiesInRender`, not `wireEntityRenderObservers`) — see structure.md Example 8 (scenario naming) and Example 16 (purpose-of-relationship naming). Programmer jargon ("snapshot path", "fresh-init", "wire observers", "apply X") describes code structure or mechanism but obscures the scenario; before finalizing a name, verify it answers "what scenario fires this?" **or "what does this maintain?"** against the actual call sites and conditions.
- **Don't write what isn't needed (D):** defensive guards/validators/compat shims for impossible states; redundant validation of internal code; scope creep; half-finished impls; cosmetic single-field wrappers; one-line passthrough wrappers. When you find one such wrapper, grep the file/class for siblings of the same shape — they travel in pairs.
- **Layout (E):** variables declared far from first use; section-divider comments instead of blank lines; multiple concepts per expression.
- **Side effects (F):** pure logic threaded with DOM/mutation/IO instead of isolated.
- **File size (G):** passes a few hundred lines AND has separable concerns. Size alone is not enough; broad-responsibility owners (per project conventions) own large surface by design.

Step 4. For each issue, emit a proposal. **No edits.** Each carries:
- A **tag**: `[EXTRACT]`, `[INVERT]`, `[RENAME]`, `[REMOVE]`, `[SPLIT]`, `[ASYMMETRY]`, `[ISOLATE]`, `[PARAMS]`, `[DECOMPOSE]`.
- A **scope**: `LOCAL` (intra-file), `MULTI-FILE` (declaration + every callsite/importer — list them via grep or TS imports), `DECOMPOSE` (cross-file file-split sketch ONLY — cite separable concerns, destination files matching repo cluster naming, post-split public API; never use for in-file multi-extract — that's `[EXTRACT] LOCAL` listing multiple helpers; `[DECOMPOSE] LOCAL` is a category error).
- An **anchor**: a signature, comment header, or short distinctive snippet the apply step can search for (robust against earlier edits shifting line numbers).

Step 5. **Persist your output to disk.** Compute the slug for <file> (path with `/`→`__` (double underscore); dots in the path including the extension are preserved — `src/foo.ts` → `src__foo.ts`). If `.review-structure.local/pass-1/proposals/<slug>.md` already exists, stop and report a slug collision; do not overwrite. Otherwise write the Output Format below to that path, with `Hash: <sha256 from Step 2>` inserted as the second line immediately under the heading. Return the Output Format **without** the Hash line as your response — the orchestrator consumes it for triage (presented to the user per *Showing code during review*).

Constraints:
- Propose only — no edits, no commits.
- Conservative on borderline calls — under-flagging beats false positives.
- Precedent isn't a veto. structure.md C.3 ("match in-repo precedent") is for *writing* new code; the code under review might *be* the precedent. If an improvement breaks a repo pattern, emit it and add a `Precedent: "<short label>"` line so the orchestrator can group precedent-breakers.
- For **[REMOVE]**: include an `Original purpose:` line — one sentence from evidence, not invention. Quote the local comment; else `git blame` the line + `git log -1` the introducing commit and quote that; else write "no surviving justification" — that's also useful evidence. If the original purpose still applies (a real runtime invariant), preserve. If it frames a hypothetical future, cross-check the introducing commit — "future" framing is sometimes retrospective rationalization for a fossil.
- For **[INVERT]**/**[EXTRACT]** in performance-tuned code: don't propose merging if a comment cites a measurable cost. `[INVERT]` against framework-prescribed lifecycle is exempt (B.5).
- For **[DECOMPOSE]** on authored content / data files: authored data, not behavior. **Never propose `[DECOMPOSE]` on a data file** (hard ban — the project keeps large canonical catalogs in `data/`; file-split sketches there are always invalid noise).
- For **[DECOMPOSE]** on files with broad responsibility by design (manager-style classes, top-level orchestrators the project supplement names): propose only if separable concerns are concrete and destination files respect the existing cluster naming convention.
- For **exported shapes/types/functions**: check at least one consumer site before deciding — `route.fromId` may be unclear where the surrounding type isn't visible.
- Begin your response with the line `<file> (<line-count> lines) — <count> proposals`. Nothing above it — no "let me analyze", no preamble. The orchestrator parses your output for triage and translates rule codes / elides bodies before showing the user (per *Showing code during review*).

Output format (concise, structured — skip preamble):

  <file>.ts (<line-count> lines) — <count> proposals
  1. [EXTRACT]   LOCAL — extract <name>(<args>) from <containing fn>; <why>.
        Anchor: "<short snippet>"
  2. [RENAME]    MULTI-FILE — <oldName> → <newName> in <file> (<why>).
        Anchor: "<short snippet>"
        Precedent: "<pattern label>"   (only if it breaks a repo-wide pattern)
        Callsites (<n>): <file>, <file>, ...
  3. [REMOVE]    LOCAL — drop <description>; <why removal is safe>.
        Anchor: "<short snippet>"
        Original purpose: <one sentence — quote local comment / introducing commit / "no surviving justification">.
  4. [DECOMPOSE] DECOMPOSE — sketch: split <file> into:
          - <new-file-1>.ts (<symbols>)
          - <new-file-2>.ts (<symbols>)
        Concerns: <concern 1>; <concern 2>.
        Public API: <file-1> exposes <X>; <file-2> exposes <Y>.

Borderline-kept: 0-5 lines noting close calls and why not proposed.
Optional top-level observations — ≤3 bullets on cross-file patterns. Skip if nothing rises above per-proposal level.
Optional `Cross-cluster candidates` — 0-3 bullets on patterns that look cluster-wide from this file but need cluster-scope review to confirm. **Not counted as proposals**; no callsite enumeration required. Format: `<pattern> — visible across <N> functions in this file, may extend to <cluster>`.
```

## Pass 2 agent prompt template (comments — edit in place, on settled code)

Send this to each Pass 2 subagent. Replace `<file>` with the assigned path, `<N>` with the batch size, and `<repo>` with the absolute path to the project root. Send **exactly one** opening variant — the staged variant when an approved Pass 1 edit actually changed this file (including a `MULTI-FILE` rename that touched it as a callsite), the comments-only variant otherwise (including every file in *comments only* mode, plus default-mode files Pass 1 left untouched). Delete the other variant and its bracket label.

```
Apply the project's comment style guide to a single file. This is one of <N> parallel agent runs in a controlled review — careful, conservative, explicit.

**[STAGED RUN — send this variant when Pass 1 ran:]** This file has already been through an approved structural-review pass. Renames, extractions, removals, and inversions the user accepted are already in the code. This matters: a comment a rename or extraction has *fully* made redundant should be DELETED, not rewritten — the new name or extracted function name carries what the comment used to say (structure.md C.2 "rename instead of commenting"; the extract rule "the function name becomes the comment"). But if the rename only stales part of a comment that still carries non-obvious WHY, REWRITE to drop the stale token and keep the WHY (see Step 4). Don't rewrite a comment to re-explain code a rename just clarified; and don't assume more structure changed than did — review the file as it actually reads now.

**[COMMENTS-ONLY RUN — send this variant when Pass 1 was skipped:]** No structural review preceded this run. Review the comments in this file exactly as it currently stands; do not assume any rename, extraction, or other structural change has been applied (none has).

Step 1. Read `.claude/skills/review-structure/structure-comments.md` in full. Worked examples: dividers must carry information not labels; formula-encoded values get purpose-first comments; lead with purpose then rationale; rewriting longer to add the missing point is valid; when rewriting, verify against the implementing code, not the existing comment. Then read `<repo>/AGENTS.md` (or equivalent conventions file) in full — it carries project-specific reserved/rejected vocabulary and architecture terms the comment rules defer to (relevant for `[VOCAB]` tagging and verifying rewrites against project conventions). Then check for `dev/code-rules/structure-comments.md` at the project root; if present, read it as additions/overrides.

Step 2. Read <file> in full (its current, post-structural-review state). Multiple reads if large — don't truncate. (The SHA-256 you'll record in Step 5 is of the file's post-Step-4-edit content, not the bytes read here — so the orchestrator's partial-resume can compare it against the file's current SHA-256 and catch a manual edit between Pass 2 apply and triage.)

Step 3. For each comment (`//`, `/** */`, `/* */`) — including JSDoc on declarations and inline notes — evaluate:
- Explains non-obvious WHY, or just restates the name/type/next line?
- Could renaming clarify it instead? (And: did a Pass 1 rename already make it redundant?)
- Accurate vs. the current code?
- Concrete (named scenario/outcome) or abstract?
- Purpose-first or mechanism-first?
- Bare divider that should carry a fact or be deleted?
- Restates a formula encoded right below?
- Style: structural declarations (types, interfaces, enums, classes, functions, methods, fields) take JSDoc; variable declarations (incl. module-level `const`) and inline notes take `//`. Exception: exported `const` may take JSDoc when it's a public knob importers see in hover-docs.

Step 4. Apply edits with the Edit tool. **Before each REWRITE or DELETE Edit call, capture the comment's exact original text byte-for-byte** — you'll need it for step 5's `Was-verbatim:` block, and the original bytes won't be on disk after the edit lands.
- DELETE comments that just repeat code, are decorative dividers, or were *fully* made redundant by an applied Pass 1 rename/extraction; if the rename only stales part of a comment that still carries non-obvious WHY, REWRITE (drop the stale token, keep the WHY) instead.
- REWRITE comments that are abstract → concrete, mechanism → purpose, formula-restating → consequence-stating, or stale.
- ADD only when the code can't show genuinely non-obvious context a reader needs.

Step 5. **Persist your edit summary to disk.** Compute the slug for <file> (path with `/`→`__` (double underscore); dots in the path including the extension are preserved — `src/foo.ts` → `src__foo.ts`). If `.review-structure.local/pass-2/edits/<slug>.md` already exists, stop and report a slug collision; do not overwrite. Otherwise compute the SHA-256 of the file's current (post-edit) content and write the Output below to that path, with `Hash: <sha256>` inserted as the second line immediately under the heading. **In the disk note, under each `REWRITE` and `DELETE` entry, add a `Was-verbatim:` block holding the changed comment's exact original text byte-for-byte** — the orchestrator needs it to restore the comment precisely if the user reverts that edit after a context reset. Return the Output **without** the Hash line and **without** the `Was-verbatim:` blocks as your response — the orchestrator consumes the response for triage (presented to the user per *Showing code during review*).

Constraints:
- Don't change non-comment code. Don't change behavior.
- Conservative on borderline calls — over-keeping beats over-deleting.
- For every REWRITE: verify the new claim against the implementing code, not by paraphrasing the existing comment. Cite the file:lines you read. If you can't justify the new claim from code, leave the original. Comments drift; paraphrase propagates errors. The failure mode is **sharpening** — a vague comment (`// suffix follows the original claim`) paraphrased into a specific false claim (`the original claimant always wins`) when the code (`const owner = nation ?? nameNation.get(baseName)`) does the opposite: the current caller wins, the map is only a fallback. The `verified against <file:lines>` line forces the read that catches this and makes the verification observable.
- For every REWRITE: self-check for programmer jargon you introduced or preserved (idempotent, no-op, memoized, rehydrated, "WHAT:" prefixes, etc.). If any, propose a plain-English paraphrase inline and tag `[JARGON]`.

Output (concise, structured — skip preamble):
- Header: `<deleted> deleted / <rewritten> rewritten / <added> added / <kept> kept`. Add `[HEAVY]` if 5+ substantive (non-routine) edits.
- Tag each edit:
  - `[ROUTINE]` — style swap (`//`↔`/** */`), pure-restate delete, divider drop matching established pattern, or a delete of a comment an applied rename made redundant
  - `[ADD]` — created comment where none existed
  - `[STALE]` — fixed a factually-wrong claim (cite the wrong fact in `<reason>`)
  - `[VOCAB]` — introduced/replaced a noun phrase (cite the grep verifying project vocabulary)
  - `[JARGON]` — rewrite preserves/introduces jargon; include a proposed plain-English paraphrase
  - When in doubt, leave untagged — the orchestrator treats untagged as substantive (individual review).
- REWRITE: `L<line> [TAGS] REWRITE: "<before-shape>" → "<after-shape>" — verified against <file:lines>` (≤30 words/side)
- DELETE: `L<line> [TAGS] DEL: "<comment-shape>" — <reason>`
- ADD: `L<line> [TAGS] ADD: "<new comment>" — <reason>`
- Borderline-kept: 0-5 lines noting close calls
- (Files >500 lines) Top-level observations: ≤3 bullets on patterns
```

## Context management

- **State on disk.** Per-file proposals (Pass 1) and edits (Pass 2) live under `.review-structure.local/`; `progress.md` holds the ledger and position. Nothing needed to resume lives only in context.
- **Checkpoint as you go.** Append to `progress.md` per batch dispatch, triage decision, applied item, validation pass. Resume reads `progress.md` first.
- **Know when to reset.** When orchestrator context is heavy, say so plainly and tell the user to `/clear` and re-invoke — the run resumes from `progress.md` + per-file notes with no loss.

## Scope tags (Pass 1 only)

Comment edits are intra-file — no scope tags. Structure edits:

- **`LOCAL`** — apply one at a time, validate per file. Most `[EXTRACT]`/`[INVERT]`/`[REMOVE]`.
- **`MULTI-FILE`** — must apply atomically (rename in declaration but not callsites breaks typecheck). Most `[RENAME]`/`[SPLIT]`/`[ASYMMETRY]`. Proposing agent enumerates every callsite at proposal time.
- **`DECOMPOSE`** — sketch-only. File splits create files, change exports, rewrite import paths. Not auto-applied; sketch is the deliverable.

Cross-file enumeration via grep/TS-imports is best-effort (blind spots: renamed imports, shared method names, barrel re-exports). Safety net: project typecheck after apply surfaces a missed callsite; agent stops + reports; user re-greps with the anchor and recovers via editor/git.

## Per-file gotchas worth flagging when dispatching

Same four classes apply to both passes; relevant caution differs by pass:

- **Code with preconditions/invariants** (validators, parsers, state machines, transactional ops): Pass 1 — `[REMOVE]` on a guard: check if comment names a real rule it enforces. Pass 2 — long precondition comments often earn their length ("already verified X in Y, so we don't re-check here"); conservative bias critical.
- **Performance-tuned code** (rendering, hot loops, caches, throttling, batched IO, culling): Pass 1 — perf-driven structure can look like over-decomposition; don't propose merging if comment cites a measurable cost. Pass 2 — perf comments often hide non-obvious WHY (cache-key choice, allocation avoidance, early bailout); preserve unless clearly redundant.
- **Files with broad responsibility by design** (manager-style classes, top-level orchestrators): `AGENTS.md` assigns these broad ownership. Pass 1 — size alone is not justification for `[DECOMPOSE]`; propose only when separable concerns are concrete and split respects cluster naming. (Project supplement `dev/code-rules/structure.md` lists which files qualify.)
- **Authored content / data files** (config, fixtures, content tables, entity definitions): Pass 1 — authored data, not behavior; don't propose extracting from data declarations or `[DECOMPOSE]`. Pass 2 — `description:`/`label:`/`body:`/`lore:` fields are displayed content, not comments; don't touch them. Pure category-restating dividers (`// Helpers`, `// Refined wares`) should go; dividers carrying grouping info hard to infer from the items below stay.
- **Async / event-driven code** (networking, IO, scheduling, queues, lifecycle hooks, cleanup): Pass 2 — Example 4 of the comments guide is the target: concrete-scenario-with-bad-outcome beats internal-mechanism wording. Watch for rewrite candidates.

(Structure supplement `dev/code-rules/structure.md` and comment supplement `dev/code-rules/structure-comments.md` are read unchanged by their respective passes.)

## Tuning the batch

- Size-balance batches — don't put five 1500-line files in one. ~5 subagents/batch, parallel within, serial across.
- Full codebase sweep: many batches at the ~5/batch cap, both passes; budget ~10 min wall-clock per batch.
- Pass 1 apply: `LOCAL` one at a time per file; `MULTI-FILE` as atomic set; `DECOMPOSE` sketches only.
- After Pass 1's approved edits and after each Pass 2 batch: run validation (typecheck, lint, test) per `AGENTS.md`. Report in plain English. Commit only when the user asks.
