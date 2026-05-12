---
name: review-structure
description: "[lav] Review code structure via parallel subagents — propose extracts, inversions, renames, removals per structure style guide; user approves each"
---

# Review Structure

Orchestrate a parallel structural review across the files the user passes in. One focused subagent per file. Each agent reads the structure style guide (`.claude/coding/structure.md`, plus `dev/coding/structure.md` at the project root if present), identifies structural issues in its assigned file, and emits a structured proposal list. **No edits during the propose step.** The user reviews proposals and chooses which to apply; the apply step runs the approved subset, with behavior depending on each proposal's scope.

This skill is **user-initiated**: only run when explicitly invoked (via `/review-structure` or a direct request to review structure using subagents). Don't trigger on mentions of `structure.md` (the rules) — for one-off structural edits, just edit directly.

## Files to audit

`$ARGUMENTS`

If `$ARGUMENTS` is empty, ask the user for the file list (or for a sample they want — by directory, size, or domain). Don't pick files autonomously.

## Workflow

### Propose (parallel)

1. **Resolve the file list** from `$ARGUMENTS` (or from the user's clarification). Confirm with the user before dispatching if the list is large or the scope is ambiguous.
2. **Dispatch one subagent per file in parallel** using the agent prompt template below. Cap each batch at ~5 agents — large files take 2-3× longer, and oversized batches stall on tail agents. If the user passed more than 5 files, batch them and run sequentially (parallel within batch, serial across batches).
3. **Wait for all batches to return.** The propose step doesn't gate on validation; subagents may run project-defined typecheck/lint passively to surface pre-existing issues, but the user is reviewing proposals, not signing off on file health.
4. **Triage and review.** Present proposals grouped by scope and tag, with counts. Ask the user how to proceed. Substitute real counts and labels into the shape below:

   ```
   12 total proposals across 4 files.

   Of those, 5 break repo precedent, grouped by pattern (skip this section if no proposals break precedent):
     • "*ForManager suffix" — 3 proposals (5, 9, 12)
     • "find*Lowest/find*Highest pair" — 2 proposals (3, 7)

   Review mode?
     1. Per-proposal — review each individually
     2. Bundle by tag — accept whole categories at once (e.g. all [REMOVE] proposals — accept all)
     3. High-stakes only — auto-accept low-risk extractions and removes within a single file, review cross-file renames individually, hold file-split sketches for separate discussion
     4. Cluster-pattern proposals: bundle for separate review — group precedent-breaking proposals (e.g. all `*ForManager` renames) into one decision; cascade the rest to mode 1
   ```

   Adapt as decisions emerge: once the user rules on a pattern, demote that pattern to bundled accept-all for the remaining proposals.

   After accepting a proposal that changes duplication or count metrics (an extraction collapsing N similar lines, a rename merging two concepts), re-evaluate any pending proposals that cited the original count. Flag anything that drops below the threshold its rule cites — the user may want to skip it now that the basis weakened.

### Showing code during review

Default: file path, function signatures, and call sites only. Bodies stay elided. The user has the file open — they don't need to re-read it. Pasted statements that aren't moving are noise the user has to scan past to find what changes.

- Label every block with the file path on the first line as a comment (e.g. `// src/sim-trade-decision.ts`). Multiple files = multiple labels.
- Show signatures and the call shape. Bodies become `// N lines: <one-phrase purpose>` placeholders — never restate the statements that aren't moving. Restating-and-then-labeling is the failure mode.
- Mark new vs. unchanged. Every block in a post-edit view labels itself `NEW`, `CHANGED`, or `unchanged` — without markers the user has to compare the snippet to the open file line-by-line to find the change boundary. Use `// NEW helper` above a new signature, `// CHANGED — was X; becomes:` immediately above the moved line, `// N lines unchanged: <purpose>` for elided regions.
- For extractions: one block per file, the post-extract view only — not before+after. The new function's signature; the caller with the new call inserted; everything else elided.
- For renames: the call-site line at the new name. Don't show either function body.
- For inversions: the new top-of-function control flow only. Elide the body that didn't change.
- For removals: the lines being removed. Surrounding context only when the proposal turns on it (e.g. a guard whose comment names a rule).
- Reflect any renames the user has already agreed to in the surrounding code, even if the rename hasn't been applied yet.

Show body content only when the proposal's evaluation genuinely depends on it. Even then, show only the lines that matter — not the surrounding context. If you're tempted to paste a function body to "give context," elide it instead.

**For multi-option judgment calls: include a short code sample under each option, not just under the prompt.** When asking the user to choose between A/B/C, each option should carry a concrete code block showing what that option looks like at the relevant declaration AND/OR call site — bodies still elided per the rules above. Reading three labeled bullets without seeing the resulting code forces the user to mentally simulate each option from prose; the diff between options is what they're choosing between, so show the diff. If the user has to ask "show me code examples," the prompt was malformed. The cost is one extra fenced block per option (~5 lines each); the saved round-trip is worth it.

### Apply (only on approved proposals; behavior depends on scope)

5. **For each approved `LOCAL` proposal:** apply via `Edit`. Run the project-defined validation (typecheck, lint, test) as specified in the project's `AGENTS.md` (or equivalent conventions file). If a check reports a new failure, the agent stops and reports; the user recovers manually (editor undo, git, etc.). The skill does not manage rollback.
6. **For each approved `MULTI-FILE` proposal:** apply every edit in the set in order, then run project-defined validation once across the affected files. Same failure model — if validation fails, the agent stops and reports.
7. **Apply `LOCAL` proposals one at a time per file.** Structural edits compound, batching makes failure attribution hard. `MULTI-FILE` sets are atomic by definition (the rename or split needs every callsite to land together).
8. **Apply ordering within a single file:** apply that file's `LOCAL` proposals before any `MULTI-FILE` proposal that touches its symbols. Local extractions and inversions can change line numbers; doing them first keeps later anchors searchable.
9. **Stop on anchor miss:** if a proposal's anchor (function signature, comment header, or distinctive snippet) isn't found in the current file when applying, stop and report. Don't substitute or guess — an earlier edit may have changed the file in a way the proposing agent didn't anticipate.
10. **`DECOMPOSE` proposals are not auto-applied.** The propose-only sketch (target files, moved symbols, import path changes) is the deliverable; the user decides whether to act on it manually or in a separate dedicated step.
11. **After all approved edits applied across the batch:** run the project's full test suite as defined in `AGENTS.md`. **Don't commit unless the user asks.**

## Agent prompt template

Send this to each subagent. Replace `<file>` with the assigned path and `<N>` with the batch size.

```
Apply the project's code structure guide to a single file. This is one of <N> parallel agent runs in a controlled review — be careful, conservative, and explicit in your output. **This is the propose step — do not edit the file in this run.**

Step 1. Read `.claude/coding/structure.md` in full. The 27 rules across 7 clusters cover function size and decomposition, control flow and nesting, naming, code that doesn't need to exist, layout within a function, side effects, and file size as a signal. Then check for `dev/coding/structure.md` at the project root; if present, read it as additions/overrides to the base rules — including project-specific file-pattern guidance.

Step 2. Read <file> in full. Use multiple reads if the file is large — don't truncate.

Step 3. Walk the file and evaluate each function, scope, and structural pattern against the rules. Look for:
- **Function size and decomposition (cluster A):** function too long; multiple unrelated jobs in one function; a block needs a `// what` comment to explain itself; bool flag argument changing behavior fundamentally; 4+ parameters.
- **Control flow and nesting (cluster B):** more than 2-3 levels of nesting; missing guard clauses; `else` after `return` / `throw`; accumulating `let result` instead of returning early; init-then-do ordering for our own APIs (framework lifecycle is exempt).
- **Naming (cluster C):** acronyms or shortenings; a rename would replace a comment; precedent set elsewhere is ignored; asymmetric paired operations; mutation hidden in a non-mutating-sounding name; field names on exported shapes that escape across files — `{ fromId, toId }` should be `{ fromStationId, toStationId }` if consumers read fields in isolation. **For helpers extracted from a branch or relationship, name from the real-world scenario that fires the branch (e.g. `restoreSavedGame`, not `applySnapshotPath`) or the purpose of the relationship (e.g. `mirrorSimEntitiesInRender`, not `wireEntityRenderObservers`)** — see structure.md Examples 9-11. Programmer jargon ("snapshot path", "fresh-init", "wire observers", "apply X") describes code structure or mechanism but obscures the scenario the reader needs to understand. Before finalizing a name, verify it answers "what scenario fires this?" or "what does this maintain?" against the actual call sites and conditions.
- **Don't write what isn't needed (cluster D):** defensive guards / validators / compat shims for problems that can't happen; redundant validation of internal code; scope creep in a focused change; half-finished implementations; cosmetic single-field wrapper types — `interface Trip { legs: TripLeg[] }` should collapse to `TripLeg[]` if every consumer peels the wrapper; one-line passthrough wrappers — `function getA(x) { return getB(x); }` should be inlined and the wrapper deleted. **When you find one such wrapper, grep the same file/class for siblings of the same shape** — passthroughs to imported free functions tend to travel in pairs or trios; missing a sibling means an inconsistent cleanup where the user gets one wrapper dropped but not the others.
- **Layout (cluster E):** variables declared far from first use; section-divider comments instead of blank lines; multiple concepts crammed into one expression.
- **Side effects (cluster F):** pure logic threaded with DOM writes / mutation / IO instead of isolated.
- **File size (cluster G):** file passes a few hundred lines AND has separable concerns. Size alone is not enough — files designated as broad-responsibility owners (per the project's conventions) own large surface areas by design.

Step 4. For each issue found, emit a proposal. **No edits.**

Each proposal carries:
- A **tag** stating the type of fix:
  `[EXTRACT]`, `[INVERT]`, `[RENAME]`, `[REMOVE]`, `[SPLIT]`, `[ASYMMETRY]`, `[ISOLATE]`, `[PARAMS]`, `[DECOMPOSE]`
- A **scope** stating which files it touches:
  - `LOCAL` — intra-file only.
  - `MULTI-FILE` — declaration plus every callsite or importer. The proposal must list them (use `grep` or TypeScript imports listing).
  - `DECOMPOSE` — cross-file file-split sketch ONLY. Must cite separable concerns, destination files (matching repo cluster naming), and post-split public API. **Do NOT use `[DECOMPOSE]` for in-file multi-extract** — when one function should split into N helpers within the same file, use `[EXTRACT] LOCAL` and list multiple new helpers in a single proposal. `[DECOMPOSE] LOCAL` is a category error.
- An **anchor** — a function signature, comment header, or short distinctive code phrase that the apply step can search for. The anchor is robust against earlier edits in the same file shifting line numbers.

Constraints:
- Don't edit anything in this run — propose only.
- Conservative on borderline calls — under-flagging beats false positives. Over-flagging adds noise; the user reviews each proposal.
- Precedent isn't a veto. structure.md rule C.3 ("match in-repo precedent") is guidance for *writing* new code. For review, the code we're reviewing might *be* the precedent — and the precedent might not be how the user wants things. If a structural improvement would break a repo pattern, emit the proposal and tag it with a `Precedent: "<short pattern label>"` line so the orchestrator can group precedent-breaking proposals and offer the user a "reject all" path. Don't demote a real proposal to borderline-kept on precedent grounds alone.
- For **[REMOVE]** proposals: include an `Original purpose:` line — one sentence sourced from evidence, not invention. Quote the local comment if it gives the actual reason, otherwise run `git blame` on the line and `git log -1` on the introducing commit and quote that. If neither shows intent, write "no surviving justification" — that's also useful evidence. Then evaluate: if the original purpose still applies (a real runtime invariant the guard enforces, e.g. "we already verified X in Y, so we don't re-check here"), preserve. If the comment frames a hypothetical future ("kept as a guard for future X"), cross-check the introducing commit — the "future" framing is sometimes retrospective rationalization for a fossil from a deleted past data shape.
- For **[INVERT]** / **[EXTRACT]** in performance-tuned code: performance-driven structure (caching, throttling) sometimes looks like over-decomposition. Don't propose merging if the comment cites a measurable cost.
- For **[DECOMPOSE]** on authored content / data files: authored data, not behavior. Don't propose.
- For **[DECOMPOSE]** on files with broad responsibility by design: project conventions assign broad ownership to certain files (manager-style classes, top-level orchestrators). Propose only if separable concerns are concrete and destination files would respect the existing cluster naming convention. The project supplement (`dev/coding/structure.md`) lists which files in this project fall into that category.
- For **MULTI-FILE** proposals: enumerate every callsite at proposal time. The orchestrator and user need the full set to evaluate.
- For **exported shapes, types, and functions**: check at least one consumer site before deciding what to propose. The declaration alone doesn't tell you how a name reads in context — `route.fromId` may be unclear at the consumer where the surrounding type isn't visible. Use `grep` to find one external read and confirm names work there too.
- Begin your response with the line `<file> (<line-count> lines) — <count> proposals`. Nothing above it. No "let me analyze", no "Key observations:" summary, no consider-then-discard preamble drafts. A terse `Considered: <alternative>` note inside an actual proposal is fine. Borderline-kept and Top-level observations come AFTER the proposal block, not before. The orchestrator forwards your output verbatim — anything above the header is noise the user has to skip past.

Output format (concise, structured — skip preamble):

```
<file>.ts (<line-count> lines) — <count> proposals
1. [EXTRACT]   LOCAL — extract <name>(<args>) from <containing fn>; <why>.
      Anchor: "<short snippet>"
2. [RENAME]    MULTI-FILE — <oldName> → <newName> in <file> (<why>).
      Anchor: "<short snippet>"
      Precedent: "<pattern label>"   (only if this proposal breaks a repo-wide pattern; omit otherwise)
      Callsites (<n>): <file>, <file>, ...
3. [REMOVE]    LOCAL — drop <description>; <why removal is safe>.
      Anchor: "<short snippet>"
      Original purpose: <one sentence — quote the local comment, the
      introducing commit's message, or write "no surviving justification">.
4. [DECOMPOSE] DECOMPOSE — sketch: split <file> into:
        - <new-file-1>.ts (<symbols>)
        - <new-file-2>.ts (<symbols>)
      Concerns: <separable concern 1>; <separable concern 2>.
      Public API: <file-1> exposes <X>; <file-2> exposes <Y>.
```

Borderline-kept: 0-5 lines noting close calls — issues you considered but decided not to propose, and why.

Optional top-level observations — ≤3 bullets on patterns you noticed across the file. Skip if nothing rises above the per-proposal level.

Optional `Cross-cluster candidates` — 0-3 bullets on patterns that look cluster-wide from this file but need cluster-scope review to confirm. **Not counted as proposals**; no callsite enumeration required. Format: `<pattern> — visible across <N> functions in this file, may extend to <cluster>`.
```

## Why propose-only

Structural edits change behavior; comment edits don't. A bad parallel batch of structural edits could land subtle regressions in five files at once before the user sees them. Propose-only keeps the user in the loop on every change. Promoting specific edit categories to auto-apply later is possible once a pattern is well-trusted, similar to how `review-comments` accumulated triage modes.

## Why scope tags

Different proposal types touch different file sets, and the apply step has to handle them differently:

- **`LOCAL`** can apply one at a time and validate per file. Most `[EXTRACT]`, `[INVERT]`, and `[REMOVE]` proposals.
- **`MULTI-FILE`** must apply every edit atomically — a rename that lands in the declaration but not the callsites breaks typecheck. Most `[RENAME]`, `[SPLIT]`, and `[ASYMMETRY]` proposals. The proposing agent is responsible for enumerating every callsite at proposal time so the user can evaluate the full impact.
- **`DECOMPOSE`** is sketch-only — file splits create new files, change exports, and rewrite import paths. The skill does not auto-apply these; the sketch is the deliverable.

## Cross-file enumeration is best-effort

`MULTI-FILE` proposals enumerate callsites with `grep` or TypeScript imports listing. This catches direct callers reliably, but has known blind spots:
- **Renamed imports** (`import { foo as bar } from "..."`) — `grep foo` won't find the local `bar(...)` call site.
- **Method names on shared types** — `grep getShip` matches every type with a `getShip` method, not just the one being renamed.
- **Re-exports through index files** — a callsite that imports through a barrel file may use a path the proposer didn't search.

The safety net is the project's typecheck (per `AGENTS.md`) after the apply step. A missed callsite usually surfaces as a typecheck failure at the reference. When that happens, the agent stops and reports; the user re-greps with the anchor word, finds the missed reference, and either amends the change set or recovers via their editor / git as they normally would.

## Per-file gotchas worth flagging when dispatching

- **Code with preconditions or invariants** (validators, parsers, state machines, transactional or atomic operations): precondition comments and "we already verified X in Y, so we don't re-check here" comments often justify their length. When proposing `[REMOVE]` on a guard, check if the comment names a real rule the guard is there to enforce.
- **Performance-tuned code** (rendering, hot loops, caches, throttling, batched IO): performance-driven structure (caching, throttle reasoning) sometimes looks like over-decomposition or over-extraction. Don't propose merging a function back inline if the comment cites a measurable cost. `[INVERT]` against framework-prescribed lifecycle methods is exempt per rule B.5.
- **Files with broad responsibility by design** (manager-style classes that own a domain, top-level orchestrators): `AGENTS.md` often assigns these broad, authoritative ownership of a domain. Size alone is not justification for `[DECOMPOSE]`. Propose only when separable concerns are concrete and the split respects the existing cluster naming convention.
- **Authored content / data files** (config, fixtures, content tables, authored entity definitions): authored data, not behavior. Don't propose extracting from data declarations or `[DECOMPOSE]` on data files.

## Tuning the batch

- Size-balance batches when possible — don't put five 1500-line files in one batch.
- Apply sequencing: `LOCAL` proposals apply one at a time per file; `MULTI-FILE` proposals apply as one atomic set across the listed files; `DECOMPOSE` proposals are sketch deliverables only.
- After applying any approved batch: run the project-defined validation (typecheck, lint, test) per `AGENTS.md`. Commit only when the user asks.
