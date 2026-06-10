# deep-simplify subagent prompt templates

Read by the orchestrator at dispatch and sent to subagents, substituting the placeholders each template names. The Phase 1 (per-file) prompt is sent at Phase 1, the Phase 2 (cross-file synthesis) prompt at Phase 2, the Phase 3 (plan synthesis) prompt at Phase 3. Each template is self-contained — it carries its own copy of the rule-stack read order, because the orchestrator sends each to a separate subagent in isolation. `SKILL.md` owns the orchestration that dispatches these; this file holds the three payloads.

## Phase 1 agent prompt template

Replace `<file>` with the assigned source file path, `<N>` with the batch size, and `<repo>` with the absolute path to the project root.

```
Deep-simplify a single file: step back and find where it should be rewritten simpler or clearer, including changes that alter behavior when a project runtime invariant licenses them. One of <N> parallel runs. **Propose only — do not edit the file. Write ONLY to your own note file `.deep-simplify.local/notes/<file>.md`; never edit `progress.md` or any other run-state file the orchestrator owns.**

Step 1. Read the rule stack in order: `.claude/skills/deep-simplify/deep-simplify.md`, then `<repo>/dev/code-rules/deep-simplify.md` if present (the project license list — if absent, every candidate is behavior-preserving), then `<repo>/AGENTS.md`, then `.claude/skills/review-structure/structure.md`, then `<repo>/dev/code-rules/structure.md` if present (project structure supplement), then `.claude/skills/review-structure/structure-comments.md` (rules for M9 candidates).

Step 2. Compute the SHA-256 of <file> via `shasum -a 256 <file>` and remember it (call this `hash_pre`). Read <file> in full (multiple reads if large — don't truncate). After all reads complete, compute the SHA-256 again (`hash_post`). If `hash_pre` ≠ `hash_post`, the file changed mid-analysis — stop now and return `<file> — UNSTABLE (file changed mid-read)`; the orchestrator re-dispatches once the file settles. If they match, record that hash on the `Hash:` line. For exported symbols, check at least one consumer site.

Step 3. Walk the file. For each mechanism/function/field, ask the Decision questions in deep-simplify.md. Classify every candidate by move (M1–M9) and as behavior-preserving OR behavior-changing. For a candidate that removes a symbol, also record its **removal fallout** within this file: the imports the removal leaves unused (which `noUnusedLocals` then rejects) and the comment or file-header lines the removal makes false. Dropping that fallout is part of the one removal, so the note must list it — the Phase 3 synthesizer reads notes, not source, and can't recover it later.

For a behavior-changing candidate, the note MUST carry all of:
- License: the verbatim runtime invariant from the project list that makes the old behavior unnecessary. None fits → reduce to behavior-preserving or drop. Do not invent a license.
- Original purpose: one sentence from evidence — quote the local comment, else `git blame` the line + `git log -1` the introducing commit and quote that, else "no surviving justification".
- Verified against <file:lines>: the specific code you read that proves the old path is unreachable under that invariant.
- Announced change: one sentence stating what's being replaced and the new mechanism (also serves as the commit subject if applied).
- Guard test: the exact test to write — what it asserts and why it FAILS or materially differs under the OLD behavior. For a removal of a path unreachable by construction (a dead branch past a validation boundary, an accumulator whose carry-over can no longer occur), a compile-level difference — the old signature or arity no longer compiles — is a valid "differs under OLD" signal; only genuinely-reachable paths need a runtime-differing test.

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
     (removal only:) Fallout: imports the removal orphans (unused → `noUnusedLocals` fails), comment/header lines it makes false
  ## Cross-file hooks
  - <symbol> duplicates|derives-from|wraps|re-validates <file>:<symbol> — <one line>
  ## Borderline-kept
  - <0–5 close calls and why not proposed>

After writing, read the note back and verify its shape before returning: line 1 is the bare `# <file> (<line-count> lines)` heading (no extra prefix), line 2 begins with `Hash: ` with no blank line between them, and every candidate line starts with its number. Counting isn't enough — the literal first-two-lines shape must hold, because the orchestrator's partial-resume keys off the `Hash:` line and a malformed note surfaces late (at Phase 2 synthesis or a resume hash-check). Fix any deviation in place before returning.

Step 5. Return EXACTLY one line, nothing else — no heading (no `## Step 5`, no `# Final report`, no anything), no preamble, no summary, no commentary, no quoting the note back:
`<file> — <n> candidates (<#preserving>/<#changing>), <m> cross-file hooks` (or `<file> — UNSTABLE (file changed mid-read)` per Step 2).

Constraints: conservative — under-propose; a guard for a state the runtime can't reach is what this skill removes, never add one. No edits, no commits — the note file is the only thing you write. Don't restate code; the note is analysis.
```

## Phase 2 agent prompt template

Replace `<repo>` with the absolute path to the project root.

```
Synthesize cross-file simplifications, then verify each at the code. Read the rule stack in order (same as Phase 1): `.claude/skills/deep-simplify/deep-simplify.md`, `<repo>/dev/code-rules/deep-simplify.md` if present, `<repo>/AGENTS.md`, `.claude/skills/review-structure/structure.md`, `<repo>/dev/code-rules/structure.md` if present, `.claude/skills/review-structure/structure-comments.md`. **Propose only — write ONLY to `.deep-simplify.local/cross-file.md`; never edit `progress.md` or any other run-state file the orchestrator owns.**

Step 1. Read every file in `.deep-simplify.local/notes/` (walk the tree recursively — notes mirror source file paths). Cluster the "Cross-file hooks" into candidate cross-file simplifications (M1/M8 duplicated mechanism; M3 mergeable registries; M2 field derivable across modules; import-direction violations; M5 vocabulary drift; M7 wrapper whose only callers are elsewhere). A single strong hook is a candidate — no minimum-note count.

Step 2. For EACH candidate, verify it against the actual code with targeted `rg` / import-listing / focused reads — "only caller is elsewhere", import-direction, and "these two registries are mergeable" are unprovable from notes and will not typecheck if wrong. Drop or correct candidates the code contradicts. Do not finalize a behavior classification or cite a license from notes alone — ground it against the code you read, or mark the candidate `UNVERIFIED — needs a code decision`.

Step 3. Write `.deep-simplify.local/cross-file.md`: each surviving candidate as one proposal — files + symbols, move, Scope, behavior-preserving vs changing (with License + Verified against if changing), `supersedes`/`conflicts-with` any per-file item, and the order constraint. List `UNVERIFIED` candidates separately.

Step 4. Return EXACTLY one line, nothing else — no heading, no preamble, no summary, no enumeration of the proposals or files counted, no showing your work to justify the numbers, no commentary: `<k> verified, <u> unverified cross-file proposals across <m> files`.
```

## Phase 3 agent prompt template

Replace `<repo>` with the absolute path to the project root, `<gen>` with the plan generation (`1` on first run; the Phase 4 re-hash rule increments on regeneration), and — regeneration only — `<prev-plan-path>` with `.deep-simplify.local/plan-g<prev-gen>.md` (preserved by the orchestrator before regen — see Phase 3 description), `<applied-list>` with the items the superseded-generation ledger records as `APPLIED` (ordinals `g<prev-gen>:#<num>` that the subagent resolves to proposal content by reading `<prev-plan-path>`), and `<open-queue-list>` with the prior-generation queue items still open (a `QUEUED-TO-QUESTIONS` line with no `ANSWERED-*`/`SUPERSEDED` close), each as an ordinal `g<prev-gen>:#<num>` the subagent resolves the same way.

```
Synthesize the batched simplification plan. Read the rule stack in order (same as Phases 1 and 2): `.claude/skills/deep-simplify/deep-simplify.md`, `<repo>/dev/code-rules/deep-simplify.md` if present, `<repo>/AGENTS.md`, `.claude/skills/review-structure/structure.md`, `<repo>/dev/code-rules/structure.md` if present, `.claude/skills/review-structure/structure-comments.md`. **Propose only — write ONLY `.deep-simplify.local/plan.md`, do not edit any source file, and never edit `progress.md` or any other run-state file the orchestrator owns.**

Step 1. Read every file in `.deep-simplify.local/notes/` (walk the tree recursively — notes mirror source paths) and `.deep-simplify.local/cross-file.md`. **Regeneration only:** also read `<prev-plan-path>` to resolve `<applied-list>` ordinals to their proposal content.

Step 2. Build the plan as generation `<gen>`:
- **Two tracks.** Behavior-preserving (batchable). Behavior-changing — each carries its `License:`, `Original purpose:`, `Verified against:`, the `Announced change:` subject, and the `Guard test:` spec; never bundled.
- **Ordered** by the `Scope` + `Symbols` join: `LOCAL` before `MULTI-FILE` touching the same symbols; a cross-file consolidation that `supersedes`/`conflicts with` a per-file item is sequenced first and the superseded item dropped. **When a LOCAL item renames or removes a symbol, rewrite downstream items' anchors to use the post-rename text** — otherwise the downstream items anchor-miss against their own batch (the *Anchor miss triage* in Phase 4 flags this as a plan defect). **A removal item also carries its note's removal fallout** — the imports the removal orphans and the comment/header lines it makes false — so dropping them is part of that one item, not a separate item and not left for the applier to notice (a missed orphan import fails `noUnusedLocals`).
- **Batched** with a total count so Phase 4 can show `batch X/Y`. Number items `#1`…`#N`. Never bundle a behavior-changing item with other items in the same batch.
- **Rule-codification items** listed explicitly: the doc edit + the violation sweep as one item.
- **Phase 2 `UNVERIFIED` candidates** folded in as numbered must-own items (their own track), so every plan item — including ones still needing a code decision — has a number the do-all ledger and `questions.md` can anchor to.
- **Regeneration only:** for each item resolved from `<applied-list>` **and each still-open prior-generation queue item in `<open-queue-list>`**, content-match it against your new proposals; omit any new proposal whose content matches an already-applied prior item **or an open prior-generation queue item** (a re-run Phase 1 note naturally won't re-propose its done items; this clause additionally drops already-applied items from files Phase 1 did *not* re-run, and keeps an approved-but-not-yet-applied or still-queued item from being re-proposed under a second qid).

Step 3. Write `.deep-simplify.local/plan.md` with `Generation: <gen>` on the second line, immediately under the heading. The orchestrator re-parses this file on resume and regen (to map `APPLIED` ledger lines to items, repair an orphaned `questions.md` entry from its plan item, and resolve a prior generation's ordinals), so pin the item format:

  - One item per `### #<N> — <title>` heading — third-level, number first, never `####` or `### Item #N`. Items keep this heading inside their batch sections.
  - Under each item, one bold-label bullet per field: `- **Move:** <plain-English move>`, `- **Behavior:** preserving` or `- **Behavior:** changing`, `- **Scope:** LOCAL` or `- **Scope:** MULTI-FILE`, `- **Files + symbols:** <the files this item edits and the symbols it touches>`, then `- **Description:** <…>`. The `Files + symbols:` field is load-bearing — the orchestrator maps an `APPLIED` ledger line back to its file paths through it, and it is the `Symbols` half of the `Scope` + `Symbols` ordering. Keep the item's other situational fields (`From:`, `Verified against:`, `Supersedes:`, a must-own item's decision-context fields) as the plan already uses them — this pins the heading level and the labels below, not the full field set.
  - A behavior-changing item adds five more bold-label bullets, with these exact labels (same as the Phase 1 note): `- **License:** <verbatim invariant>`, `- **Original purpose:** <…>`, `- **Verified against:** <file:lines>`, `- **Announced change:** <…>`, `- **Guard test:** <…>`. Use these labels verbatim — no `Cited license:`, no parenthetical on `Guard test:`.

Step 4. Return a one-paragraph summary: the generation, the item count, the batch count, the preserving/changing split. Do not return the plan body — the orchestrator reads `plan.md` from disk.
```
