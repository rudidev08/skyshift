---
name: review-comments
description: "[lav] Review and edit comments in specified files via parallel subagents, per comments style guide; rewrites cited against the implementing code"
---

# Review Comments

Orchestrate a parallel comment review across the files the user passes in. One focused subagent per file. Each agent reads the comments style guide (`.claude/coding/comments.md`, plus `dev/coding/comments.md` at the project root if present), reviews comments in its assigned file, edits in place, and reports rewrites with citations against the code that justifies the new claim — so hallucinations surface at review time.

This skill is **user-initiated**: only run when explicitly invoked (via `/review-comments` or a direct request to review comments using subagents). Don't trigger on mentions of `comments.md` — for one-off comment edits, just edit directly.

## Files to audit

`$ARGUMENTS`

If `$ARGUMENTS` is empty, ask the user for the file list (or for a sample they want — by directory, size, or domain). Don't pick files autonomously.

## Workflow

1. **Resolve the file list** from `$ARGUMENTS` (or from the user's clarification). Confirm with the user before dispatching if the list is large or the scope is ambiguous.
2. **Dispatch one subagent per file in parallel** using the prompt template below. Cap each batch at ~5 agents — large files take 2–3× longer than small ones, and oversized batches stall on tail agents. If the user passed more than 5 files, batch them and run sequentially (parallel within batch, serial across batches).
3. **Run any project validation between batches** as defined in the project's `AGENTS.md` (or equivalent conventions file) — typecheck, lint, test commands live there. Skip if the project doesn't define validation commands. With multiple batches, validate each before dispatching the next; triage waits until all batches return (step 4).
4. **Triage and review.** After all batches return + validation passes, present the count by tag and ask the user how to review:

   ```
   N total changes across M files.
   K tagged [ROUTINE] (style swaps, divider drops, pure-restate deletes)
   L high-stakes ([ADD]/[STALE]/[VOCAB]/[JARGON]) + H [HEAVY] files

   Review mode?
     1. Bundle routines (default) — grouped accept-all by category, high-stakes individual
     2. Skip routines — auto-accept routine, only review high-stakes
   ```

   Then:
   - **High-stakes items**: per-item review with full before/after context. The user accepts, rejects, or asks a question.
   - **Routine bundles** (mode 1 only): grouped by category (e.g., "all 7 style swaps in 3 files — accept all?"). Show 1–2 representative examples per category, then the rest as a list.
   - **HEAVY files**: 1–2 sample changes per file, then bundle the rest.
   - **Adapt as you go**: once the user rules on a pattern (e.g., "drop section dividers"), demote that pattern to `[ROUTINE]` for the remaining batches — don't re-litigate decided calls.
5. **Don't commit until the user explicitly asks.** Mid-workflow commits are discouraged.

## Agent prompt template

Send this to each subagent. Replace `<file>` with the assigned path and `<N>` with the batch size.

```
Apply the project's comment style guide to a single file. This is one of <N> parallel agent runs in a controlled review — be careful, conservative, and explicit in your output.

Step 1. Read `.claude/coding/comments.md` in full. Worked examples cover: dividers must carry information not labels; formula-encoded values get purpose-first comments; lead with purpose then rationale; rewriting longer to add the missing point is also valid; when rewriting, verify against the implementing code, not the existing comment. Then check for `dev/coding/comments.md` at the project root; if present, read it as additions/overrides to the base rules.

Step 2. Read <file> in full. Use multiple reads if the file is large — don't truncate.

Step 3. For each comment (`//`, `/** */`, `/* */`) — including JSDoc on declarations and inline `//` notes — evaluate:
- Does it explain non-obvious WHY, or just restate the name/type/next line?
- Could renaming clarify it instead?
- Is it accurate vs the current code?
- Concrete (named scenario, named outcome) or abstract?
- Purpose-first or mechanism-first?
- Bare divider that should carry a fact or be deleted?
- Restates a formula encoded right below?
- Style: structural declarations (types, interfaces, enums, classes, functions, methods, fields) take JSDoc; variable declarations (incl. module-level `const`) and inline notes take `//`. Exception: exported `const` may take JSDoc when it's a public knob importers benefit from seeing in hover-docs.

Step 4. Apply edits with the Edit tool:
- DELETE comments that just repeat code or are decorative dividers.
- REWRITE comments that are abstract → concrete, mechanism → purpose, formula-restating → consequence-stating, or stale.
- ADD only when the code can't show genuinely non-obvious context a reader needs.

Constraints:
- Don't change non-comment code. Don't change behavior.
- Conservative on borderline calls — over-keeping beats over-deleting.
- For every REWRITE: verify the new claim against the implementing code, not by paraphrasing the existing comment. Cite the file:lines you read in your output. If you can't justify the new claim from code, leave the original. Comments drift; paraphrase propagates errors.
- For every REWRITE: self-check for programmer jargon you introduced or preserved (idempotent, no-op, memoized, rehydrated, "WHAT:" prefixes, etc.). If any, propose a plain-English paraphrase inline and tag the edit `[JARGON]`.

Output (concise, structured — skip preamble):
- Header: `<deleted> deleted / <rewritten> rewritten / <added> added / <kept> kept`. Add `[HEAVY]` if the file accumulated 5+ substantive (non-routine) edits.
- Tag each edit with one or more of:
  - `[ROUTINE]` — style swap (`//`↔`/** */`), pure-restate delete, divider drop matching established pattern
  - `[ADD]` — created comment where none existed
  - `[STALE]` — fixed a factually-wrong claim (cite the wrong fact in `<reason>`)
  - `[VOCAB]` — introduced/replaced a noun phrase (cite the grep verifying it's project vocabulary)
  - `[JARGON]` — rewrite preserves or introduces programmer jargon; include a proposed plain-English paraphrase
  - When in doubt, leave untagged — the orchestrator treats untagged as substantive (individual review).
- For each REWRITE: `L<line> [TAGS] REWRITE: "<before-shape>" → "<after-shape>" — verified against <file:lines>` (≤30 words per side; paraphrase if needed)
- For each DELETE: `L<line> [TAGS] DEL: "<comment-shape>" — <reason>`
- For each ADD: `L<line> [TAGS] ADD: "<new comment>" — <reason>`
- Borderline-kept: 0–5 lines noting close calls
- (For files >500 lines) Top-level observations: ≤3 bullets on patterns you saw
```

## Why citations matter

A subagent without citation discipline can paraphrase the existing comment instead of reading the code. The failure mode is **sharpening**: a vague clause ("follows the original claim") becomes a specific claim ("even if a later nation reuses it") through paraphrase, inventing falsifiable details.

This actually happened on a real run *(game dev project)*: an agent rewrote `// Owning nation per base name — suffix flavor follows the original claim.` to a sharpened form claiming the original claimant always wins. The code (`const owner = nation ?? nameNation.get(baseName)`) does the opposite — current caller wins, the map is a fallback. The "verified against" line forces the read and makes the verification observable, so a reviewer can spot-check the citation against the cited code.

## Why this triage

Route to human review when the agent makes a verifiable claim and the cost of being wrong is high — `[ADD]` (rule says "only when context lost"), `[STALE]` (positive claim about correctness), `[VOCAB]` (positive claim about a project term), `[JARGON]` (paraphrase choice the user should ratify). Bundle when the change is mechanical or follows a pattern the user already approved. Adapt as preferences emerge: early rounds bundle less, later rounds bundle more.

## Per-file gotchas worth flagging when dispatching

- **Authored content / data files** (config, fixtures, content tables, authored entity definitions): fields like `description:`, `label:`, `body:`, `message:` may look like prose comments but are actually displayed text or content payloads. Don't touch them. Section dividers are OK only if they carry grouping info hard to infer from items below; pure category-restating dividers (`// Helpers`, `// Event handlers`, `// Validation`, `// Constants`) should go.
- **Performance-tuned code** (rendering, hot loops, caches, throttling, batched IO): perf comments often hide non-obvious WHY (cache-key choice, allocation avoidance, throttle reasoning, early bailout on common inputs, *(game dev)* off-screen culling, request coalescing). Preserve unless clearly redundant.
- **Code with preconditions or invariants** (validators, parsers, state machines, transactional or atomic operations): long-looking comments often earn their length ("we already verified X in Y, so we don't re-check here"). Conservative bias is critical.
- **Async / event-driven code** (networking, IO, scheduling, queues, lifecycle hooks, cleanup/teardown): Example 4 of the guide is the target — concrete-scenario-with-bad-outcome beats internal-mechanism wording. Watch for rewrite candidates.

## Tuning the batch

- Size-balance batches when possible — don't put five 1500-line files in one batch.
- Full codebase sweep: expect many batches at the ~5/batch cap; budget ~10 min wall-clock per batch.
- After each batch: run any project validation as defined in the project's conventions file. Commit only when the user asks.
