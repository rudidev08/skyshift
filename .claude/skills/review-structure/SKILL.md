---
name: review-structure
description: "[rp] Staged code review via parallel subagents — a structure pass (propose-only, user approves each) then a comment pass that edits the settled post-structure code, per the structure + comments style guides"
---

# Review Structure

Orchestrate a **two-pass** review across the files the user passes in. **Pass 1 is structure** (propose-only): one subagent per file proposes structural fixes, the user approves a subset, the approved edits are applied and validated. **Pass 2 is comments** (edit-in-place), and it runs on the **settled post-structure files** — so a comment a rename or extraction just made redundant is correctly *dropped*, not rewritten, because the comment subagent reads the already-renamed code.

Running structure-then-comments as one staged skill is the point: `structure.md` C.2 is "rename instead of commenting" and the extract rule says "the function name becomes the comment," so a `[RENAME]`/`[EXTRACT]` routinely obsoletes a comment. Two separate skills can't coordinate that — the comment agent would review a comment against code a not-yet-applied rename is about to clarify. Staging closes that seam without giving up the comment pass's edit-in-place speed or its `Verified against:` integrity: comments are verified against final code because structure is already applied.

This skill is **user-initiated**: only run when explicitly invoked (via `/review-structure` or a direct request to review structure and comments using subagents). Don't trigger on mentions of `structure.md` / `structure-comments.md` (the rules) — for one-off edits, edit directly.

## Scope

- **Structure + comments only.** Test correctness is out of scope; don't fold test review in here.
- **Mode** (from `$ARGUMENTS` or the user's wording):
  - *default* — both passes: Pass 1, then Pass 2 on the settled files.
  - *structure only* — Pass 1 only; stop after the approved structural edits are applied and validated.
  - *comments only* — skip Pass 1; run Pass 2 on the files as-is (identical to standalone comment review).
- **Self-contained.** This skill carries the full orchestration scaffolding for both passes inline.

## Files to audit

`$ARGUMENTS`

If `$ARGUMENTS` is empty, ask the user for the file list (or for a sample they want — by directory, size, or domain). Don't pick files autonomously. Confirm before dispatching if the list is large or the scope is ambiguous.

## Work folder

`.review-structure.local/` at the repo root. The repo's `.gitignore` `*.local/` pattern covers it — check once; add the line only if that pattern is absent. Layout:

- `pass-1/proposals/<slug>.md` — one per file (Pass 1). **Slug** = file path with `/`→`-` and `.`→`-`, extension kept (`src/foo.ts` → `src-foo-ts`). Each Pass 1 subagent writes its proposal output here, with `Hash: <sha256 of the content it read>` on the second line right under the heading. Before writing, if the computed path already exists this run, **stop and report a slug collision** — never overwrite a note.
- `pass-2/edits/<slug>.md` — one per file (Pass 2). Same slug rule. Each Pass 2 subagent writes its edit summary here, with `Hash: <sha256 of the file's post-edit content>` on the second line right under the heading (so partial-resume can detect a manual edit between apply and triage). The subagent has already applied its edits in place by this point; for every edit the note records the **verbatim original comment text** (not just a shortened shape), so a `REVERTED` triage decision can restore it exactly even after a context reset. Same slug-collision stop rule.
- `progress.md` — the resume anchor. Mode, scope, resolved rule-stack paths, repo root + branch at start, Pass 1 batch ledger + per-proposal triage outcomes + applied-items ledger + validation status, the frozen Pass 2 file set, Pass 2 batch ledger + per-edit triage outcomes + validation status, and position within the current pass. Per-file Pass 1 and Pass 2 hashes live on each note's `Hash:` line, not here.

Two different file paths in the scope must not map to the same slug. The orchestrator pre-computes slugs for every file in scope at run start and rejects duplicates before dispatching any subagent.

### Ledger format

`progress.md` lines follow fixed shapes so the resuming orchestrator parses them consistently. Two kinds of line:

**Per-outcome lines** — one per item as it is handled:

- Structure triage (Pass 1): `- p1/<slug>:#<proposal-num> ACCEPTED` or `REJECTED`
- Structure apply (Pass 1): `- p1-apply/<slug>:#<proposal-num> APPLIED` — written when the proposal's `Edit` returns success, a separate line from its `ACCEPTED` triage line so resume can tell an accepted-but-not-yet-applied proposal from an applied one.
- Comment edits (Pass 2): `- p2/<slug>:L<line> KEPT` or `REVERTED`

Each per-outcome line carries a tag (`p1/`, `p1-apply/`, or `p2/`), the file slug, the item identifier (proposal number for Pass 1, line number for Pass 2), and the outcome word.

**Markers** — batch- or phase-level, not tied to one item:

- `- VALIDATION-FAILED <pass> batch <X> item <N>` — written when validation breaks during apply. For a phase-level gate (Pass 1 final validation) use `batch final item -`.
- `- VALIDATION-CLEARED <pass> batch <X>` — the recovery line. The orchestrator writes it only after the user confirms the break is fixed and validation passes again. A `VALIDATION-FAILED` marker with no `VALIDATION-CLEARED` after it means the run is still broken: resume stops and surfaces it before doing anything else.

## Workflow

Pass 1 runs to completion (propose → approve → apply → validate) **before** Pass 2 dispatches. The handoff is the whole design: Pass 2 reads whatever the post-approval tree actually is. A structural proposal the user rejected simply means Pass 2 sees the un-renamed code and reviews it normally — no dependency edges, no conditional proposals, because structure is fully settled and validated before any comment subagent looks at a file.

The Pass 2 file set is **not** just the files the user requested. An approved `MULTI-FILE` `[RENAME]`/`[SPLIT]` edits callsites and importers in files **outside** the requested set; those files now hold comments referencing the old name. Pass 2 must cover them too, or the seam-closure claim is false for exactly the cross-file renames it most needs to handle. So: **Pass 2 set = the requested files ∪ every file an approved Pass 1 proposal actually edited.**

Throughout both passes the orchestrator updates `progress.md` as batches dispatch, triage decisions land, applied items finish, and validation completes — so the run survives a context reset and can be resumed from disk.

### Run start — resume or fresh

Before resolving a new scope or mode or starting any work, check `.review-structure.local/`.

- **Empty or absent folder.** Fresh run. Resolve scope and mode (per Scope + Files to audit), compute slugs for every file in scope and reject duplicates upfront, create the work-folder subtree (`.review-structure.local/pass-1/proposals/` and `.review-structure.local/pass-2/edits/`) before writing `progress.md`, write the initial `progress.md` (mode + scope + resolved rule-stack paths + repo root + current branch), and proceed to Pass 1 (or directly to Pass 2 if mode is *comments only*).
- **Non-empty folder, `progress.md` missing or unreadable.** Stop and ask the user whether to reset; never guess at state.
- **Non-empty folder, `progress.md` valid.** Read it. Report back to the user: the saved mode, scope, which pass the run was in, and where the run was when it stopped (proposing, awaiting triage, applying mid-file, validating, or partway through Pass 2). Ask **resume** or **reset** (wipe and restart). Never silently overwrite a prior run.

On resume:
- The saved mode and scope win. If `$ARGUMENTS` passed alongside the resume conflict with the saved mode/scope, ask whether the user meant to **reset** (start over with the new arguments) or **resume** (ignore them).
- Verify the repo root and current branch match what `progress.md` recorded at start. If either differs, stop and confirm — the user may have changed checkouts since the run started.
- For each pass, dispatch only the work that wasn't already completed — see the per-pass partial-resume rules below. If the saved mode is *comments only*, no Pass 1 state was ever written; resume directly into Pass 2.

### Pass 1 — Structure (propose-only)

1. **Resolve the file list** and mode. **If mode is *comments only*, skip Pass 1 entirely and go straight to Pass 2 (step 7) — the file set is exactly the requested files, since no Pass 1 edits happened.**
2. **Dispatch one subagent per file in parallel** using the Pass 1 prompt template — each subagent writes its proposal output to `pass-1/proposals/<slug>.md` (with `Hash: <sha256 of the content as read>` on the second line) and returns the same output as its response. Cap each batch at ~5 agents — large files take 2-3× longer, oversized batches stall on tail agents. More than 5 files → batch, parallel within a batch, serial across batches, size-balanced.
3. **Wait for all batches.** The propose step doesn't gate on validation; subagents may run project-defined typecheck/lint passively to surface pre-existing issues, but the user is reviewing proposals, not signing off on file health.
4. **Triage and review.** Present proposals grouped by scope and tag, with counts. Substitute real counts/labels into the shape below:

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

5. **Apply approved proposals (behavior depends on scope):**
   - **`LOCAL`** — apply via `Edit`, one at a time per file. Run project-defined validation (typecheck, lint, test per `AGENTS.md`). New failure → stop and report; the user recovers manually (the skill does not manage rollback). Record any item whose `Edit` returned success with a `p1-apply/<slug>:#<proposal-num> APPLIED` line regardless of validation outcome (the file actually changed), and write a `VALIDATION-FAILED` marker (format per *Ledger format*) alongside. On resume, a `VALIDATION-FAILED` marker with no `VALIDATION-CLEARED` after it stops the run — the orchestrator surfaces the broken state, and writes the `VALIDATION-CLEARED` recovery line only once the user confirms the fix and validation passes again.
   - **`MULTI-FILE`** — Read each target file before editing it (callsite/importer files outside the requested set won't have been read yet — Edit needs a prior Read), apply every edit in the set in order, then validate once across **all affected files: the declaration file plus every callsite/importer the set touches, including files outside the requested set**. Atomic by definition (a rename needs every callsite to land together). On validation failure the same rule as `LOCAL` applies: the set's items get `p1-apply/<slug>:#<proposal-num> APPLIED` lines (the edits landed), a `VALIDATION-FAILED` marker (format per *Ledger format*) is written to `progress.md`, and resume stops on that marker — until a `VALIDATION-CLEARED` recovery line follows — before doing anything else.
   - **Apply ordering within a file:** that file's `LOCAL` proposals before any `MULTI-FILE` proposal touching its symbols — local edits shift line numbers; doing them first keeps later anchors searchable.
   - **`DECOMPOSE`** — not auto-applied. The propose-only sketch (target files, moved symbols, import-path changes) is the deliverable; the user decides whether to act on it separately.
   - **Anchor miss** — if a proposal's anchor isn't found when applying, stop and report. Don't substitute or guess; an earlier edit may have changed the file unexpectedly.
6. **After all approved Pass 1 edits applied:** run the project's full validation per `AGENTS.md`. On failure, write a `VALIDATION-FAILED p1 batch final item -` marker to `progress.md` and stop — resume surfaces the broken state before Pass 2 dispatches. On success the tree is now settled — this validated state is exactly what Pass 2 reviews. **Don't commit.**

**Partial-resume (Pass 1).**
- Step 2 (propose): for each file in the scope, dispatch a subagent only if `pass-1/proposals/<slug>.md` is missing OR the note's `Hash:` doesn't match the file's current SHA-256. For stale notes (hash mismatch), the orchestrator deletes the existing note before re-dispatching so the subagent's collision-stop doesn't fire on the re-run. Reuse the rest as-is.
- Step 4 (triage): on resume, continue from the next un-triaged proposal. Triage decisions are persisted in `progress.md` as per-proposal outcomes (ACCEPTED, REJECTED) — bundled and cluster-pattern decisions are expanded to per-proposal outcomes before recording, so resume sees a flat list and never re-asks.
- Step 5 (apply): `progress.md` records each applied item as it lands with a `p1-apply/<slug>:#<proposal-num> APPLIED` line — separate from the `ACCEPTED` triage line, so resume tells an accepted-but-not-applied proposal from an applied one. Re-hash a file at most **once per session**, before applying its first un-applied item this session, comparing the file's current SHA-256 to the proposal note's `Hash:`. (Files that already had items applied earlier in the run, or in a prior session, skip this check — the anchor-miss check at apply time catches drift in remaining items. A callsite/importer file edited only by a `MULTI-FILE` set has no proposal note of its own, so there is no `Hash:` to compare — it skips the check too; anchor-miss is its safety net.) Mismatch on the first check → stop and report: the file changed since the propose step; let the user decide whether to re-run Pass 1 for that file — which first deletes that slug's `p1/<slug>:#…` triage lines and its `pass-1/proposals/<slug>.md` note, so stale approvals can't be mis-applied to the renumbered proposals of the re-run — or keep the approvals and accept anchor-miss as the safety net. For `MULTI-FILE` items, the orchestrator records the item as one apply event; an interrupted mid-set apply is caught on resume by the anchor-miss check on already-replaced anchors — stop and report, user recovers via git. Note: an anchor miss on a `LOCAL` item the ledger lists as pending may instead mean the apply landed before the ledger recorded it — `git diff` distinguishes that from external drift.
- Step 6 (validate): re-run the project's full validation only if new items have been applied since the last recorded validation pass.

If mode is *structure only*, stop here.

### Pass 2 — Comments (edit-in-place, on the settled files)

7. **Compute the Pass 2 scope.** Default/structure-then-comments runs: the requested files ∪ every file an approved Pass 1 proposal actually edited (including callsite/importer files a `MULTI-FILE` edit touched). Comments-only runs: exactly the requested files. If an approved Pass 1 edit fans out widely (a heavily-imported symbol renamed), the set can exceed the requested files by a lot — surface the expanded set to the user before freezing, so they can confirm it or narrow it (e.g. to just the rename-staled comments in the extra files), per the same "confirm if large" rule in *Files to audit*. After any narrowing, compute slugs for the final Pass 2 file set and reject any new collisions (the expansion may have added files not seen at run start), then write the file set to `progress.md` — once written, it's **frozen** for the rest of the run (never recomputed on resume).

   Then **dispatch one subagent per file in parallel** using the Pass 2 prompt template over the frozen Pass 2 file set. Each subagent writes its edit summary to `pass-2/edits/<slug>.md` and returns the same output as its response. Same batching discipline (~5/batch, parallel within, serial across, size-balanced). Files Pass 1 left untouched are reviewed too — a file with zero structural proposals still gets its comments reviewed.
8. **Run project validation between batches** per `AGENTS.md`. With multiple batches, validate each before dispatching the next; triage waits until all batches return. On failure, write a `VALIDATION-FAILED p2 batch <X> item -` marker to `progress.md` and stop — resume surfaces the broken state before continuing.
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
   - **Routine bundles** (mode 1): grouped by category ("all 7 style swaps in 3 files — accept all?"); show 1-2 representative examples per category, then the rest as a list.
   - **HEAVY files**: 1-2 sample changes per file, then bundle the rest.
   - **Adapt as you go**: once the user rules on a pattern, demote it to `[ROUTINE]` for the remaining batches.
10. **Don't commit until the user explicitly asks.** Mid-workflow commits are discouraged. Report Pass 1 + Pass 2 outcomes and stop — no downstream git offers.

**Partial-resume (Pass 2).**
- Step 7 (dispatch): the Pass 2 file set is frozen in `progress.md` at step 7 and never recomputed on resume. (If the file set isn't yet in `progress.md` — the orchestrator was interrupted during step 7 before the freeze write — re-enter step 7 normally to compute it.) For each file in the frozen set, dispatch a subagent only if `pass-2/edits/<slug>.md` is missing OR the note's `Hash:` doesn't match the file's current SHA-256 (which catches a manual edit between Pass 2 apply and triage). For stale notes (hash mismatch), the orchestrator deletes the existing note before re-dispatching so the subagent's collision-stop doesn't fire on the re-run. Existence of an up-to-date edit note = that file's Pass 2 already ran. Mid-edit interruptions are rare; if a subagent was interrupted after partial edits but before writing the note, the resumed re-dispatch reads the partially-edited file and produces a benign over-edit (the user sees the result in triage).
- Step 8 (validate): re-run only if new files have completed Pass 2 since the last recorded validation pass.
- Step 9 (triage): on resume, continue from the next un-triaged edit. Triage decisions are persisted in `progress.md` as per-edit outcomes (KEPT, REVERTED) — routine-bundle rules are expanded to per-edit outcomes before recording. A `REVERTED` edit is restored from the note's `Was-verbatim:` block, and the `REVERTED` line is written only after that reverse edit lands — so the ledger never claims a revert that didn't happen.

## Showing code during review

Default: file path, function signatures, and call sites only. Bodies stay elided. The user has the file open — pasted statements that aren't moving are noise.

- Label every block with the file path on the first line as a comment (e.g. `// src/sim-trade-decision.ts`). Multiple files = multiple labels.
- Show signatures and the call shape. Bodies become `// N lines: <one-phrase purpose>` placeholders — never restate statements that aren't moving.
- Mark new vs. unchanged. Every block in a post-edit view labels itself `NEW`, `CHANGED — was X; becomes:`, or `// N lines unchanged: <purpose>`.
- Extractions: one block per file, the post-extract view only — not before+after. Renames: the call-site line at the new name. Inversions: the new top-of-function control flow only. Removals: the lines being removed, surrounding context only when the proposal turns on it.
- Reflect any renames the user already agreed to in the surrounding code, even if not yet applied.
- **Multi-option judgment calls: include a short code sample under each option**, not just under the prompt — bodies still elided. Reading three labeled bullets without seeing the resulting code forces the user to mentally simulate each option; show the diff between options.

Show body content only when the proposal's evaluation genuinely depends on it, and then only the lines that matter.

**No rule codes in user-facing text.** Cluster codes (`A.1`–`G.1`, `D.1`, `B.7`, `C.3`, etc.) and tag codes (`[EXTRACT]`, `[INVERT]`, `[REMOVE]`, etc.) live in the rule files and subagent output as internal anchors. In any text the user reads — batch headers, item descriptions during high-stakes review, grouped-bundle summaries, recap lines — translate the code to short plain English. Don't write "Per D.1, this is a defensive guard" or "Cluster D.1 (don't write what isn't needed) hits"; write "this guard defends against a state no caller produces". Don't write "[EXTRACT] LOCAL — pull out X"; write "extract X into a helper". When forwarding subagent output to the user, translate the codes before forwarding. Internal scratch (intermediate notes, the orchestrator's own bookkeeping) may keep the codes; user-facing prose must not.

## Pass 1 agent prompt template (structure — propose only)

Send this to each Pass 1 subagent. Replace `<file>` with the assigned path, `<N>` with the batch size, and `<repo>` with the absolute path to the project root.

```
Apply the project's code structure guide to a single file. This is one of <N> parallel agent runs in a controlled review — be careful, conservative, explicit. **This is the propose step — do not edit the file in this run.**

Step 1. Read `.claude/skills/review-structure/structure.md` in full. The 27 rules across 7 clusters cover function size/decomposition, control flow/nesting, naming, code that doesn't need to exist, layout, side effects, and file size as a signal. Then read `<repo>/AGENTS.md` (or equivalent conventions file) in full — it carries project-specific reserved/rejected vocabulary, preferred patterns, cluster/import boundaries, and file-naming conventions the universal rules defer to. Then check for `dev/code-rules/structure.md` at the project root; if present, read it as additions/overrides — including project-specific file-pattern guidance.

Step 2. Read <file> in full (multiple reads if large — don't truncate). Compute the SHA-256 of the content you read (`shasum -a 256 <file>` if the file is unchanged on disk; otherwise hash the bytes you actually read).

Step 3. Walk the file and evaluate each function, scope, and structural pattern against the rules:
- **Function size/decomposition (A):** too long; multiple unrelated jobs; a block needing a `// what` comment; bool flag arg changing behavior; 4+ params.
- **Control flow/nesting (B):** >2-3 nesting levels; missing guard clauses; `else` after `return`/`throw`; accumulating `let result` instead of early return; init-then-do for our own APIs (framework lifecycle exempt).
- **Naming (C):** acronyms/shortenings; a rename would replace a comment; precedent ignored; asymmetric paired operations; mutation hidden in a non-mutating name; exported-shape field names that escape across files. For helpers extracted from a branch or relationship, name from the real-world scenario that fires the branch (`restoreSavedGame`, not `applySnapshotPath`) **or the purpose of the relationship** (`mirrorSimEntitiesInRender`, not `wireEntityRenderObservers`) — see structure.md Examples 9-11. Programmer jargon ("snapshot path", "fresh-init", "wire observers", "apply X") describes code structure or mechanism but obscures the scenario; before finalizing a name, verify it answers "what scenario fires this?" **or "what does this maintain?"** against the actual call sites and conditions.
- **Don't write what isn't needed (D):** defensive guards/validators/compat shims for impossible states; redundant validation of internal code; scope creep; half-finished impls; cosmetic single-field wrappers; one-line passthrough wrappers. When you find one such wrapper, grep the file/class for siblings of the same shape — they travel in pairs.
- **Layout (E):** variables declared far from first use; section-divider comments instead of blank lines; multiple concepts per expression.
- **Side effects (F):** pure logic threaded with DOM/mutation/IO instead of isolated.
- **File size (G):** passes a few hundred lines AND has separable concerns. Size alone is not enough; broad-responsibility owners (per project conventions) own large surface by design.

Step 4. For each issue, emit a proposal. **No edits.** Each carries:
- A **tag**: `[EXTRACT]`, `[INVERT]`, `[RENAME]`, `[REMOVE]`, `[SPLIT]`, `[ASYMMETRY]`, `[ISOLATE]`, `[PARAMS]`, `[DECOMPOSE]`.
- A **scope**: `LOCAL` (intra-file), `MULTI-FILE` (declaration + every callsite/importer — list them via grep or TS imports), `DECOMPOSE` (cross-file file-split sketch ONLY — cite separable concerns, destination files matching repo cluster naming, post-split public API; never use for in-file multi-extract — that's `[EXTRACT] LOCAL` listing multiple helpers; `[DECOMPOSE] LOCAL` is a category error).
- An **anchor**: a signature, comment header, or short distinctive snippet the apply step can search for (robust against earlier edits shifting line numbers).

Step 5. **Persist your output to disk.** Compute the slug for <file> (path with `/`→`-` and `.`→`-`, extension kept — `src/foo.ts` → `src-foo-ts`). If `.review-structure.local/pass-1/proposals/<slug>.md` already exists, stop and report a slug collision; do not overwrite. Otherwise write the Output Format below to that path, with `Hash: <sha256 from Step 2>` inserted as the second line immediately under the heading. Return the Output Format **without** the Hash line as your response — the orchestrator consumes it for triage (presented to the user per *Showing code during review*).

Constraints:
- Propose only — no edits, no commits.
- Conservative on borderline calls — under-flagging beats false positives.
- Precedent isn't a veto. structure.md C.3 ("match in-repo precedent") is for *writing* new code; the code under review might *be* the precedent. If an improvement breaks a repo pattern, emit it and add a `Precedent: "<short label>"` line so the orchestrator can group precedent-breakers.
- For **[REMOVE]**: include an `Original purpose:` line — one sentence from evidence, not invention. Quote the local comment; else `git blame` the line + `git log -1` the introducing commit and quote that; else write "no surviving justification" — that's also useful evidence. If the original purpose still applies (a real runtime invariant), preserve. If it frames a hypothetical future, cross-check the introducing commit — "future" framing is sometimes retrospective rationalization for a fossil.
- For **[INVERT]**/**[EXTRACT]** in performance-tuned code: don't propose merging if a comment cites a measurable cost. `[INVERT]` against framework-prescribed lifecycle is exempt (B.5).
- For **[DECOMPOSE]** on authored content / data files: authored data, not behavior. **Never propose `[DECOMPOSE]` on a data file** (hard ban — the project keeps large canonical catalogs in `data/`; file-split sketches there are always invalid noise).
- For **[DECOMPOSE]** on files with broad responsibility by design (manager-style classes, top-level orchestrators the project supplement names): propose only if separable concerns are concrete and destination files respect the existing cluster naming convention.
- For **exported shapes/types/functions**: check at least one consumer site before deciding — `route.fromId` may be unclear where the surrounding type isn't visible.
- Begin your response with the line `<file> (<line-count> lines) — <count> proposals`. Nothing above it — no "let me analyze", no preamble. The orchestrator forwards your output verbatim.

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

Send this to each Pass 2 subagent. Replace `<file>` with the assigned path, `<N>` with the batch size, and `<repo>` with the absolute path to the project root, and send **exactly one** opening variant matching the run mode (staged vs comments-only) — delete the other and its bracket label.

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

Step 4. Apply edits with the Edit tool:
- DELETE comments that just repeat code, are decorative dividers, or were *fully* made redundant by an applied Pass 1 rename/extraction; if the rename only stales part of a comment that still carries non-obvious WHY, REWRITE (drop the stale token, keep the WHY) instead.
- REWRITE comments that are abstract → concrete, mechanism → purpose, formula-restating → consequence-stating, or stale.
- ADD only when the code can't show genuinely non-obvious context a reader needs.

Step 5. **Persist your edit summary to disk.** Compute the slug for <file> (path with `/`→`-` and `.`→`-`, extension kept — `src/foo.ts` → `src-foo-ts`). If `.review-structure.local/pass-2/edits/<slug>.md` already exists, stop and report a slug collision; do not overwrite. Otherwise compute the SHA-256 of the file's current (post-edit) content and write the Output below to that path, with `Hash: <sha256>` inserted as the second line immediately under the heading. **In the disk note, under each `REWRITE` and `DELETE` entry, add a `Was-verbatim:` block holding the changed comment's exact original text byte-for-byte** — the orchestrator needs it to restore the comment precisely if the user reverts that edit after a context reset. Return the Output **without** the Hash line and **without** the `Was-verbatim:` blocks as your response — the orchestrator consumes the response for triage (presented to the user per *Showing code during review*).

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

The disk-state architecture exists so a long run survives context resets. Hold to it:

- **State is on disk.** Per-file proposals (Pass 1) and edits (Pass 2) live under `.review-structure.local/`; `progress.md` holds the ledger and position. Nothing needed to resume lives only in context.
- **Checkpoint as you go.** The orchestrator appends to `progress.md` per batch dispatch, per triage decision, per applied item, per validation pass. Resume reads `progress.md` first.
- **Know when to reset.** When the orchestrator's context is heavy, say so plainly and tell the user to `/clear` and re-invoke — the run resumes from `progress.md` + the per-file notes with no loss.

## Why staged passes

Structure first, comments second, comments on the settled tree — this specific order is load-bearing:

- **It closes the rename↔comment seam.** A `[RENAME]`/`[EXTRACT]` that obsoletes a comment is resolved correctly because the comment subagent reads the *already-renamed* code and drops the now-redundant comment — including in callsite/importer files an approved `MULTI-FILE` edit touched, which is why the Pass 2 set expands to every file Pass 1 edited (step 7), not just the requested files. Two separate skills can't do this — the comment pass would run blind to a not-yet-applied rename.
- **The comment pass keeps its integrity and speed.** Edit-in-place stays safe and `Verified against:` stays honest because comments are verified against final code, not against code a pending structural proposal is about to change. (Going propose-only for comments instead would split verify from apply and risk a comment rewrite verified against pre-rename code, applied after the rename — staging avoids that failure mode entirely.)
- **It dissolves cross-pass dependency complexity.** No "apply this comment edit only if proposal 3 is accepted" edges, no cross-family apply ordering: structure is fully applied and validated before any comment subagent looks at a file, so each pass sees a consistent tree.

## Why propose-only for structure, edit-in-place for comments

Structural edits change behavior; a bad parallel batch could land subtle regressions in five files before the user sees them — so structure is propose-only, every change gated on user approval. Comment edits don't change behavior, and in Pass 2 there is no later structural edit that could invalidate them (Pass 1 is done) — so the comment subagent edits in place and the user triages the result, which is faster than a second propose-then-apply round. Same asymmetry the family already uses, made safe by ordering rather than by holding everything for approval.

## Why scope tags (Pass 1 only)

Comment edits are always intra-file — no scope tags. Structure edits aren't:

- **`LOCAL`** applies one at a time, validate per file. Most `[EXTRACT]`/`[INVERT]`/`[REMOVE]`.
- **`MULTI-FILE`** must apply atomically — a rename in the declaration but not the callsites breaks typecheck. Most `[RENAME]`/`[SPLIT]`/`[ASYMMETRY]`. The proposing agent enumerates every callsite at proposal time.
- **`DECOMPOSE`** is sketch-only — file splits create files, change exports, rewrite import paths. Not auto-applied; the sketch is the deliverable.

Cross-file enumeration via grep/TS-imports is best-effort (blind spots: renamed imports, shared method names, barrel re-exports). The safety net is the project typecheck after apply — a missed callsite surfaces there; the agent stops and reports, the user re-greps with the anchor and recovers via editor/git.

## Per-file gotchas worth flagging when dispatching

Same four classes apply to both passes; the relevant caution differs by pass:

- **Code with preconditions/invariants** (validators, parsers, state machines, transactional ops): Pass 1 — when proposing `[REMOVE]` on a guard, check if the comment names a real rule it enforces. Pass 2 — long precondition comments often earn their length ("we already verified X in Y, so we don't re-check here"); conservative bias is critical.
- **Performance-tuned code** (rendering, hot loops, caches, throttling, batched IO, culling): Pass 1 — performance-driven structure can look like over-decomposition; don't propose merging if a comment cites a measurable cost. Pass 2 — perf comments often hide non-obvious WHY (cache-key choice, allocation avoidance, early bailout); preserve unless clearly redundant.
- **Files with broad responsibility by design** (manager-style classes, top-level orchestrators): `AGENTS.md` assigns these broad ownership. Pass 1 — size alone is not justification for `[DECOMPOSE]`; propose only when separable concerns are concrete and the split respects cluster naming. (Project supplement `dev/code-rules/structure.md` lists which files qualify.)
- **Authored content / data files** (config, fixtures, content tables, entity definitions): Pass 1 — authored data, not behavior; don't propose extracting from data declarations or `[DECOMPOSE]`. Pass 2 — `description:`/`label:`/`body:`/`lore:` fields are displayed content, not comments; don't touch them. Pure category-restating dividers (`// Helpers`, `// Refined wares`) should go; dividers carrying grouping info hard to infer from the items below stay.
- **Async / event-driven code** (networking, IO, scheduling, queues, lifecycle hooks, cleanup): Pass 2 — Example 4 of the comments guide is the target: concrete-scenario-with-bad-outcome beats internal-mechanism wording. Watch for rewrite candidates.

(The structure project supplement `dev/code-rules/structure.md` and comment project supplement `dev/code-rules/structure-comments.md` are read unchanged by their respective passes.)

## Tuning the batch

- Size-balance batches — don't put five 1500-line files in one batch. ~5 subagents/batch, parallel within, serial across.
- Full codebase sweep: expect many batches at the ~5/batch cap, both passes; budget ~10 min wall-clock per batch.
- Pass 1 apply sequencing: `LOCAL` one at a time per file; `MULTI-FILE` as one atomic set; `DECOMPOSE` sketch deliverables only.
- After Pass 1's approved edits and after each Pass 2 batch: run project-defined validation (typecheck, lint, test) per `AGENTS.md`. Report results in plain English. Commit only when the user asks.
