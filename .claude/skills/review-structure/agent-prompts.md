# review-structure subagent prompt templates

Read by the orchestrator at dispatch and sent to subagents, substituting `<file>` / `<slug>` / `<N>` / `<repo>`. The Pass 1 (structure) prompt is sent at Pass 1 step 2; the Pass 2 (comments) prompt at Pass 2 step 7. `SKILL.md` owns the orchestration that dispatches these; this file holds the two payloads.

## Pass 1 agent prompt template (structure — propose only)

Send this to each Pass 1 subagent. Replace `<file>` with the assigned path, `<slug>` with the file's precomputed slug, `<N>` with the batch size, and `<repo>` with the absolute path to the project root.

```
Apply the project's code structure guide to a single file. This is one of <N> parallel agent runs in a controlled review — be careful, conservative, explicit. **This is the propose step — do not edit the file in this run.**

Step 1. Read `.claude/skills/review-structure/structure.md` in full. Its rules — in seven clusters — cover function size/decomposition, control flow/nesting, naming, code that doesn't need to exist, layout, side effects, and file size as a signal. Then read `<repo>/AGENTS.md` (or equivalent conventions file) in full — it carries project-specific reserved/rejected vocabulary, preferred patterns, cluster/import boundaries, and file-naming conventions the universal rules defer to. Then check for `dev/code-rules/structure.md` at the project root; if present, read it as additions/overrides — including project-specific file-pattern guidance.

Step 2. Read <file> in full (multiple reads if large — don't truncate). Compute the SHA-256 of the content you read (`shasum -a 256 <file>` if the file is unchanged on disk; otherwise hash the bytes you actually read).

Step 3. Walk the file and evaluate each function, scope, and structural pattern against the rules:
- **Function size/decomposition (A):** too long; multiple unrelated jobs; a block needing a `// what` comment; bool flag arg changing behavior; 4+ params.
- **Control flow/nesting (B):** >2-3 nesting levels; missing guard clauses; `else` after `return`/`throw`; accumulating `let result` instead of early return; init-then-do for our own APIs (framework lifecycle exempt).
- **Naming (C):** acronyms/shortenings; a rename would replace a comment; precedent ignored; asymmetric paired operations; mutation hidden in a non-mutating name; exported-shape field names that escape across files. For helpers extracted from a branch or relationship, name from the real-world scenario that fires the branch (`restoreSavedGame`, not `applySnapshotPath`) **or the purpose of the relationship** (`mirrorSimEntitiesInRender`, not `wireEntityRenderObservers`) — see structure.md Example 8 (scenario naming) and Example 16 (unit + meaning over mechanism words; its addendum covers purpose-of-relationship naming). Programmer jargon ("snapshot path", "fresh-init", "wire observers", "apply X") describes code structure or mechanism but obscures the scenario; before finalizing a name, verify it answers "what scenario fires this?" **or "what does this maintain?"** against the actual call sites and conditions.
- **Don't write what isn't needed (D):** defensive guards/validators/compat shims for impossible states; redundant validation of internal code; scope creep; half-finished impls; cosmetic single-field wrappers; one-line passthrough wrappers. When you find one such wrapper, grep the file/class for siblings of the same shape — they travel in pairs.
- **Layout (E):** variables declared far from first use; section-divider comments instead of blank lines; multiple concepts per expression.
- **Side effects (F):** pure logic threaded with DOM/mutation/IO instead of isolated.
- **File size (G):** passes a few hundred lines AND has separable concerns. Size alone is not enough; broad-responsibility owners (per project conventions) own large surface by design.

Step 4. For each issue, emit a proposal. **No edits.** Each carries:
- A **tag**: `[EXTRACT]`, `[INVERT]`, `[RENAME]`, `[REMOVE]`, `[SPLIT]`, `[ASYMMETRY]`, `[ISOLATE]`, `[PARAMS]`, `[DECOMPOSE]`.
- A **scope**: `LOCAL` (intra-file), `MULTI-FILE` (declaration + every callsite/importer — list them via grep or TS imports), `DECOMPOSE` (cross-file file-split sketch ONLY — cite separable concerns, destination files matching repo cluster naming, post-split public API; never use for in-file multi-extract — that's `[EXTRACT] LOCAL` listing multiple helpers; `[DECOMPOSE] LOCAL` is a category error).
- An **anchor**: a signature, comment header, or short distinctive snippet the apply step can search for (robust against earlier edits shifting line numbers).

Step 5. **Persist your output to disk.** Your slug is `<slug>` (provided above). If `.review-structure.local/pass-1/proposals/<slug>.md` already exists, stop and report a slug collision; do not overwrite. Otherwise write the Output Format below to that path, with `Hash: <sha256 from Step 2>` as **line 2 of the file** — the heading is line 1, the Hash line is line 2, with **no blank line between them**. Example placement: line 1 = `<file> (<line-count> lines) — <count> proposals`, line 2 = `Hash: 609491b2...`, line 3 = blank, line 4 = `1. [EXTRACT] ...`. **Line 1 of the disk note is the bare heading `<file> (<line-count> lines) — <count> proposal(s)` at column 0 — no `# `/`## `/`### ` markdown prefix, no `File:` preamble, no scratch prose above it. The line MUST match `^[^ ]+\.\w+ \(\d+ lines?\) — \d+ proposals?$`; a stray `## ` (or any other prefix) violates the contract. The "no preamble" rule below applies to BOTH the response AND the disk note — they share the same line-1 shape.** Return the Output Format **without** the Hash line as your response — the orchestrator consumes it for triage (presented to the user per *Showing code during review*).

Constraints:
- Propose only — no edits, no commits.
- Conservative on borderline calls — under-flagging beats false positives.
- Precedent isn't a veto. structure.md C.3 ("match in-repo precedent") is for *writing* new code; the code under review might *be* the precedent. If an improvement breaks a repo pattern, emit it and add a `Precedent: "<short label>"` line so the orchestrator can group precedent-breakers.
- For **[REMOVE]**: include an `Original purpose:` line — one sentence from evidence, not invention. Quote the local comment; else `git blame` the line + `git log -1` the introducing commit and quote that; else write "no surviving justification" — that's also useful evidence. If the original purpose still applies (a real runtime invariant), preserve. If it frames a hypothetical future, cross-check the introducing commit — "future" framing is sometimes retrospective rationalization for a fossil.
- For **[INVERT]**/**[EXTRACT]** in performance-tuned code: don't propose merging if a comment cites a measurable cost. `[INVERT]` against framework-prescribed lifecycle is exempt (B.5).
- For **[DECOMPOSE]** on data files: these are data, not behavior. **Never propose `[DECOMPOSE]` on a data file** (hard ban — the project keeps large canonical catalogs in `data/`; file-split sketches there are always invalid noise).
- For **[DECOMPOSE]** on files with broad responsibility by design (manager-style classes, top-level orchestrators the project supplement names): propose only if separable concerns are concrete and destination files respect the existing cluster naming convention.
- For **exported shapes/types/functions**: check at least one consumer site before deciding — `route.fromId` may be unclear where the surrounding type isn't visible.
- Begin your response with the heading line from Step 5 (`<file> (<line-count> lines) — <count> proposals`) and nothing above it — the no-preamble rule in Step 5 covers the response too. The orchestrator parses your output for triage and translates rule codes / elides bodies before showing the user (per *Showing code during review*).

Output format (concise, structured — skip preamble):

  <file> (<line-count> lines) — <count> proposals
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

Send this to each Pass 2 subagent. Replace `<file>` with the assigned path, `<slug>` with the file's precomputed slug, `<N>` with the batch size, and `<repo>` with the absolute path to the project root. Send **exactly one** opening variant — the staged variant when an approved Pass 1 edit actually changed this file (including a `MULTI-FILE` rename that touched it as a callsite), the comments-only variant otherwise (including every file in *comments only* mode, plus default-mode files Pass 1 left untouched). Delete the other variant and its bracket label.

```
Apply the project's comment style guide to a single file. This is one of <N> parallel agent runs in a controlled review — careful, conservative, explicit.

**[STAGED RUN — send this variant when Pass 1 ran:]** This file has already been through an approved structural-review pass. Renames, extractions, removals, and inversions the user accepted are already in the code. This matters: a comment a rename or extraction has *fully* made redundant should be DELETED, not rewritten — the new name or extracted function name carries what the comment used to say (structure.md C.2 "rename instead of commenting"; the extract rule "the function name becomes the comment"). But if the rename only stales part of a comment that still carries non-obvious WHY, REWRITE to drop the stale token and keep the WHY (see Step 4). Don't rewrite a comment to re-explain code a rename just clarified; and don't assume more structure changed than did — review the file as it actually reads now.

**[COMMENTS-ONLY RUN — send this variant when no Pass 1 edits landed on this file:]** No Pass 1 structural edits were applied to this file — either Pass 1 was skipped (*comments only* mode), or Pass 1 reviewed this file but no edits were approved. Review the comments against the file exactly as it currently stands; do not assume any rename, extraction, or other structural change has been applied (none has).

Step 1. Read `.claude/skills/review-structure/structure-comments.md` in full. Worked examples: dividers must carry information not labels (Example 5); formula-encoded values get purpose-first comments (Example 6). Key rules: lead with purpose then rationale; rewriting longer to add the missing point is valid; when rewriting, verify against the implementing code, not the existing comment. Then read `<repo>/AGENTS.md` (or equivalent conventions file) in full — it carries project-specific reserved/rejected vocabulary and architecture terms the comment rules defer to (relevant for `[VOCAB]` tagging and verifying rewrites against project conventions). Then check for `dev/code-rules/structure-comments.md` at the project root; if present, read it as additions/overrides.

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

Step 5. **Persist your edit summary to disk.** Your slug is `<slug>` (provided above). If `.review-structure.local/pass-2/edits/<slug>.md` already exists, stop and report a slug collision; do not overwrite. Otherwise compute the SHA-256 of the file's current (post-edit) content and write the Output below to that path, with `Hash: <sha256>` as **line 2 of the file** — the Header line (the `<deleted> deleted / <rewritten> rewritten / <added> added / <kept> kept` summary from the Output below) is line 1, the Hash line is line 2, with **no blank line between them**. **In the disk note, under each `REWRITE` and `DELETE` entry, add a `Was-verbatim:` block holding the changed comment's exact original text byte-for-byte** — the orchestrator needs it to restore the comment precisely if the user reverts that edit after a context reset. Before returning, read the disk note back and verify every layout rule below — counting alone isn't enough, the literal shape must hold:

  (a) **line 1** is the Header (`<deleted> deleted / <rewritten> rewritten / <added> added / <kept> kept`, possibly with a trailing `[HEAVY]` tag) and **line 2** begins with `Hash: ` — no blank line above either line, no other lines between them, AND nothing above line 1 at all (no `File: <path>` preamble, no `Edits for ...` heading, no scratch prose — delete it).

  (b) **exactly one Header line in the whole file** — if you drafted multiple summaries (e.g. an initial `0 deleted / 0 rewritten / ...` then a corrected `4 deleted / ...`), delete all but the final one and place that one on line 1.

  (c) **every body REWRITE entry matches `^L<digits> \[<tags>\] REWRITE: ...`** and **every body DEL entry matches `^L<digits> \[<tags>\] DEL: ...`** — checked literally:
    - line MUST start with `L` followed by digits at column 0 — no leading `- ` bullet, no indentation, no whitespace prefix.
    - the `L<digits>` line number is a **single integer**, not a range — `L41 ` is valid, `L41-44 ` / `L1-2 ` / `L21-25 ` are violations (rewrite into a single L-number; pick the first line of the run).
    - the action token is the literal four-character `DEL:` (not `DELETE`, not `DEL —`, not lowercase) or the literal `REWRITE:` (not `REWRITE —`, not `REWRITE [STALE] lines 1-4`).
    - prose-form entries like `REWRITE [STALE] lines 1-4 (top-of-file note)` or `DELETE — top-of-file header (was lines 1-2)` are violations even though they count in (e) below — rewrite into the `L<line> [TAGS] REWRITE:` / `L<line> [TAGS] DEL:` shape.
    - **the `[<tags>]` brackets are MANDATORY — never omit them.** `L1 REWRITE: ...` (no brackets) is a violation; the line MUST read `L1 [<tags>] REWRITE: ...`. If no listed tag fits the edit, use `[REVIEW]` — bare brackets satisfy the regex AND signal individual-review for triage. Catch this with a literal grep: every line beginning `^L[0-9]+ ` must contain `] REWRITE:` or `] DEL:` (the closing bracket plus space immediately before the action token).

  (d) **every `Was-verbatim:` block begins with `Was-verbatim:` at column 0** — no leading whitespace, no two-space indent, no list-marker. The block sits between the REWRITE/DEL entry it belongs to and the next entry, at the leftmost column.

  (e) REWRITE + DEL entries in the body count equals `Was-verbatim:` block count equals `<deleted>` + `<rewritten>` from the header. (Count check, applied to the layout-corrected file from (a)-(d).)

Fix every layout violation in place — remove stray blank lines and prose preamble, move the Hash to line 2, strip `- ` bullet prefixes from L-lines, replace ranges with single line numbers, rewrite prose-form entries into the literal shape, un-indent `Was-verbatim:` blocks, and re-add any missing block — before returning. Return the Output **without** the Hash line and **without** the `Was-verbatim:` blocks as your response — the orchestrator consumes the response for triage (presented to the user per *Showing code during review*).

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
  - `[REVIEW]` — no other tag fits; the orchestrator treats `[REVIEW]` as substantive (individual review). Use this when you'd otherwise be tempted to omit the brackets — never emit `L<line> REWRITE: ...` without `[<tags>]`. Bare-bracket `[]` is also valid but `[REVIEW]` is clearer.
- REWRITE: `L<line> [TAGS] REWRITE: "<before-shape>" → "<after-shape>" — verified against <file:lines>` (≤30 words/side)
- DELETE: `L<line> [TAGS] DEL: "<comment-shape>" — <reason>`
- ADD: `L<line> [TAGS] ADD: "<new comment>" — <reason>`
- Borderline-kept: 0-5 lines noting close calls
- (Files >500 lines) Top-level observations: ≤3 bullets on patterns
```
