---
name: review-tests
description: "[rp] Mutation-test specified tests via sequential subagents — apply logic mutations to source, strengthen tests against survivors (or fix bugs the mutations expose), propose pruning candidates. User-initiated only; don't auto-trigger on mentions."
---

# Review Tests (Mutation Testing)

## Goal

- Orchestrate sequential mutation-testing subagents (one per domain) over user-specified tests; apply small logic mutations to source, strengthen tests against survivors or fix real bugs, and propose pruning candidates.

## Rules

- User-initiated only — run only via `/review-tests` or a direct request to mutation-test specific tests.
- Default: sequential agents in the main checkout (no worktrees). User may opt into parallel-worktree mode explicitly.
- Exclusive source-file ownership: each source file is owned by exactly one agent's domain.
- Skill never commits to the starting branch. Work branch only; step 8 unwinds.
- Hard cap: 20 mutants per agent.
- If `$ARGUMENTS` is empty, ask the user — don't auto-pick.

## Convergence on re-run

- Re-running the same scope is a convergence test, not a duplicate. Expect FEWER survivors and DIFFERENT mutation classes than the prior run, not zero.
- Non-decreasing survivor count is fine. *Increasing* count on the same domain is the warning sign — ask the user whether the prior run's strengthening was committed to `<starting>`. (A `git log` grep for `agent <domain>:` won't show it: step 8 hands changes back uncommitted and the user writes their own commit message.) If they confirm it landed and survivors still rose, a third run is warranted.

## Files to test

`$ARGUMENTS`

If empty, ask the user which tests to mutate (named files, a directory, or "all").

## Workflow

0. **Pre-flight green baseline.** Run the project's test command (`npm test`, `cargo test`, `pytest`, etc.) and confirm all tests pass. Mutation testing assumes a clean baseline. If any test fails, surface the failing tests to the user and STOP — don't proceed onto a red baseline (no work branch, no agents). A red test inside a domain's own file makes every mutant in that domain read as "killed" (phantom kills), so the agent reports coverage that doesn't exist. Dirty `git status` is OK — step 0.5 captures it.

0.5. **Create the work branch.** Do these in order; later steps depend on earlier ones:
   - **Capture starting branch:** run `git rev-parse --abbrev-ref HEAD` and **remember the value**. Substitute this name into every `<starting>` reference in later steps — Bash invocations get fresh shells, so a `STARTING=...` shell variable does not persist.
   - **Refuse if detached HEAD:** test with `git symbolic-ref -q HEAD` (exit code 1 = detached). If detached, surface to the user and stop. (`git rev-parse --abbrev-ref HEAD` returns the literal string `HEAD` in this state — don't treat that as a branch name.)
   - **Refuse if in-progress merge/rebase/cherry-pick:** check for `.git/MERGE_HEAD`, `.git/rebase-merge/`, `.git/rebase-apply/`, `.git/CHERRY_PICK_HEAD`, or any `git ls-files -u` output. If present, surface to the user and stop — committing through unresolved conflict markers would corrupt both the work branch and the user's in-progress operation.
   - **Detect orphan work branches BEFORE creating new one:** `git branch --list 'review-tests-wip-*'`. If any exist, surface and ask user to delete or resume. Don't auto-resolve. (Order matters: doing this AFTER `checkout -b` would always match the just-created branch.) On **resume**, do NOT continue this step 0.5 — HEAD is already on the work branch — follow the **Resuming an interrupted run** section below instead.
   - **Create the work branch:** `git checkout -b review-tests-wip-<id>` (short timestamp or random id). Immediately record the starting branch on it, so a resume after `/clear` can recover the base once HEAD has moved onto the work branch: `git config branch.review-tests-wip-<id>.review-tests-base <starting>` (stored in `.git/config`, survives `/clear`; git discards it with the branch at step 8 path A, or carries it to the renamed branch on path B).
   - **If `git status` was dirty:** gate the WIP commit on whether TRACKED changes exist — `if ! git diff --quiet || ! git diff --cached --quiet; then git add -u && git commit -m "WIP: pre-skill working state"; fi` (the `--cached` half catches already-staged tracked changes; `git diff --quiet` alone misses them). This stages only modified TRACKED files. Then handle untracked files (`git ls-files --others --exclude-standard` — exits 0 whether the list is empty or not) by case:
     - **A WIP commit was created** (tracked changes existed): surface untracked files and ask which (if any) to fold in via `git add <files> && git commit --amend --no-edit`.
     - **No WIP commit** (tree was untracked-only): surface untracked files the same way; if the user wants any, capture them as a FRESH commit `git add <files> && git commit -m "WIP: pre-skill working state"` — never `--amend`. With no WIP commit, `--amend` would rewrite the inherited base commit on the work branch (content stays recoverable, but the WIP↔strengthening boundary and step-8 path B's `<wip-sha>` are lost).
     Never blanket-`-A` — that sweeps `.env`, scratch dirs, `*.local.md` drafts, and other intentionally-untracked content into the WIP commit and onto `<starting>` at step 8 unwind.

1. **Resolve the file list** from `$ARGUMENTS` or clarification. Confirm scope before dispatching when broad.

2. **Map tests to source files mechanically.**
   a. Extract test imports (e.g. `grep -E "^import.*from \"\.\." <test>`) and resolve relative paths to concrete source paths.
   b. **Trace through fixture files** (`*-test-fixtures.ts`, `factories.ts`, `conftest.py`) — follow their imports too; those source files are in scope.
   c. Build `Map<source-file, test-files-that-import-it>`. Any source file with ≥2 importers forces those tests into one domain.
   d. Balance domains by source-file LOC, not test-file count. Aim for similar total LOC per domain — pairing a 2000-LOC cluster with a 100-LOC pure-transform under one agent wastes the small file's budget.
   e. Print mapping: `Domain <name>: <test files> → <source files> (~N LOC)` for user sanity-check before dispatch. `<name>` is a short slug derived from the dominant source-file prefix (e.g. `sim-trade`, `sim-station`, `sim-ship-action`) — reuse this slug as `<domain>` in step 4's commit message and the per-domain gotcha matcher.
   f. Agent count is fallout, not a target. Sane range 3–10. Below 3 → over-merged (split largest); above 10 → over-split (fold smallest into sibling).

3. **Dispatch subagents sequentially.** One agent at a time in the main checkout — no `isolation: "worktree"`. Use the agent prompt template below. Integrate (step 4) before launching the next.
   - Sequential avoids parallel agents writing the same files at once and corrupting test runs.
   - Worktree-parallel is opt-in only (see Parallel-worktree mode).
   - An agent that errors or returns a malformed report (not a clean "zero survivors" result) is re-dispatched once; a second failure surfaces to the user — never silently skip that domain, or its source files go unmutated with no record.

4. **Per-agent integration (between agents).**
   - Inspect: `git status --porcelain` and `git diff --stat`. Source changes mean an explicit bug fix (verify vs. report) or a stray mutation; surprise files are speculative cleanup that doesn't belong.
   - Read the agent's summary; verify survivor count and resolutions.
   - **A self-report is never the verdict — sanity-check the SUMMARY footer against the tree.** Confirm the footer arithmetic closes (`tried == killed + survived + non-applicable`) and that `git diff --stat` shows test-file changes consistent with the claimed `<test-strengthenings>` / `<bug-fixes>` counts. A footer that doesn't close, or claims strengthenings the diff doesn't show, means the agent's report diverged from what it actually did — re-inspect before committing rather than committing on its say-so.
   - Apply any code fixes the agent flagged as real bugs (rare — most survivors are test gaps).
   - **Commit immediately to the work branch** — no approval prompt needed (work branch is throwaway). Stage the exact test paths the agent names under its "Files changed" section with an explicit-path add — `git add -- <test files named in the agent report>` (new and modified alike); do NOT use `git add -A` or a directory pathspec (re-opens the blanket-add hazard step 0.5 bans and could stage a stray source mutation or deletion).
     Commit message: `agent <domain>: <T> tests strengthened (<X> mutations, <Y> killed, <Z> source fixes)` where `<T>` is the count of strengthened tests, `<X>` total mutations tried, `<Y>` killed by the unmodified suite, `<Z>` real bug fixes the agent committed. No run-number prefix — re-runs are tracked by the user's invocation count, not by commit metadata; the prefix gives per-agent attribution in the work-branch log the user reviews at steps 5 and 8 — it is NOT a re-run signal. Re-run-as-convergence is detected by asking the user (see Convergence on re-run); these commits never reach `<starting>` because step 8 deletes the work branch (Path A) or renames it to `review-tests-prior-<id>` (Path B).
   - Confirm no tracked changes remain (`git status --porcelain` shows only `??`-prefixed untracked entries, or is empty) before dispatching the next agent. Untracked files from step 0.5 are expected to persist.

5. **Final integration check.**
   - `git log --oneline <starting>..HEAD` shows WIP commit (if any), one strengthening commit per agent (`agent <domain>:`), and any `fix:` commits agents committed mid-session per Workflow-per-mutant step 2e. Extra `fix:` commits are expected and legitimate — don't squash or drop them.
   - `git diff <starting>..HEAD --stat` reports only test-file changes plus any intentional source bug fixes.

6. **Validate integrated state.** Run full test command, type checker, and linter on the work branch — all must pass. If any fail, debug and fix in a follow-up commit on the work branch (don't unwind the prior commit).

7. **Walk pruning candidates with the user.** Each agent's report has a "Pruning candidates" section:
   - **Safe-delete** — sibling test catches same mutants. Batch all into one user-confirmation; delete in a single work-branch commit after approval.
   - **Review** — looks low-value but proof incomplete. Walk one-by-one; don't intermix with Safe-delete batch. Approved deletes go into a separate commit (or fold with Safe-deletes if the user prefers).
   - **Keep** — surfaced for transparency; no action.

8. **Return to `<starting>`.** Path A hands changes back as uncommitted edits; path B parks them on a side branch.
   - Show user `git log --oneline <starting>..HEAD` and `git log --stat <starting>..HEAD`.
   - **Warn explicitly when a WIP commit exists:** "Your pre-skill dirty state was captured as commit `<wip-sha>`; path A will mix it into one unstaged diff with the skill's strengthening + prunings. The boundary is recoverable only via path B."
   - Get explicit approval, and ask which path to take:
     - **A (no WIP, or user accepts mixed state):** on the work branch, `git reset --soft <starting>` (moves the work-branch ref to `<starting>`'s commit, keeps changes staged) → `git restore --staged .` (unstages; working tree unchanged) → `git checkout <starting>` (no-op for working tree since both refs point to the same commit) → `git branch -d <work-branch>` (deletes — succeeds because the branch's tip equals HEAD, so it's fully merged; if `-d` refuses, STOP and surface to the user — don't fall back to `-D`, which would discard commits silently).
     - **B (keep the WIP↔strengthening boundary as separate commits):** the work branch keeps everything; just step off and rename. `git checkout <starting>` (the work branch's WT is clean from the last integration commit, so the checkout switches HEAD cleanly), then `git branch -m review-tests-wip-<id> review-tests-prior-<id>`. The user's working tree is now clean on `<starting>`; everything lives on `review-tests-prior-<id>` only. **If a WIP commit exists** — it's the one messaged `WIP: pre-skill working state` in the `git log --oneline <starting>..HEAD` shown above (call it `<wip-sha>`; every other commit is `agent <domain>:` or `fix:`) — **tell the user explicitly:** "`git checkout review-tests-prior-<id> -- .` then `git restore --staged .` restores the COMBINED end state (your pre-skill edits *and* the skill's strengthening/prunings/fixes) as uncommitted edits. To recover ONLY your pre-skill edits: `git checkout <wip-sha> -- .` then `git restore --staged .`." Two diff commands split the boundary: `git diff <starting>..<wip-sha>` shows only the WIP; `git diff <wip-sha>..review-tests-prior-<id>` shows only the skill's strengthening + prunings + any agent `fix:` commits. **If no WIP commit exists**, there are no pre-skill edits to preserve — the strengthening lives on `review-tests-prior-<id>` as separate commits, recoverable via `git diff <starting>..review-tests-prior-<id>` or `git checkout review-tests-prior-<id> -- .` then `git restore --staged .`. User cleans up `review-tests-prior-<id>` when done.
   - Either way: skill does NOT commit or push to `<starting>`; user reviews and commits when ready.

## Resuming an interrupted run

Entered when step 0.5 detects an orphan `review-tests-wip-<id>` branch and the user answers **resume** (not delete). After a real mid-run `/clear`, HEAD is already on that work branch, so step 0.5 does NOT re-run — no new branch, no re-captured starting, no new WIP commit. Do this:

a. **Re-derive `<starting>` — never from HEAD.** HEAD is the work branch now, so `git rev-parse --abbrev-ref HEAD` would capture `review-tests-wip-<id>` as `<starting>` and the run could never return to the real base. Read the base recorded when the branch was created: `git config --get branch.review-tests-wip-<id>.review-tests-base`, and use that value for every `<starting>` reference for the rest of the run. If the key is absent (an orphan from a run predating this record, or a hand-made branch), don't guess — surface the non-`review-tests-*` local branches that are ancestors of HEAD (`git branch --format='%(refname:short)' | grep -v '^review-tests-'`, kept only where `git merge-base --is-ancestor <branch> HEAD` succeeds) and ask the user which is `<starting>`.

b. **Continue only the not-yet-finished domains.** Re-run steps 1–2 to recover the full domain list, then read what already landed: `git log --format='%s' <starting>..HEAD`. A domain that already has an `agent <domain>:` commit is done — do NOT re-dispatch it (a second commit for one domain breaks one-commit-per-domain). Dispatch the remaining domains per step 3, with the one exception in (c). Do not add another WIP commit: the pre-skill tracked changes were already captured before the cut.

c. **A domain left strengthened-but-uncommitted at the cut is re-dispatched, not committed from memory.** A `/clear` can land after an agent returned but before its step-4 commit, leaving that domain's test file edited (`git status --porcelain` shows a tracked ` M`/`MM` test file) with the agent's report — the mutation and killed counts — gone. You cannot honestly fill `<X> mutations, <Y> killed` from a lost report, and fabricating or zero-filling them to satisfy the step-4 format is dishonest. So treat that domain as not done and re-dispatch its agent (step 3): it reads the already-strengthened test file, re-runs its own mutation pass, and returns a fresh report. Commit at step 4 with THAT report's counts — they honestly describe this dispatch (which may find fewer survivors, since the earlier strengthening is still in the file). Don't discard the uncommitted edits first; the re-dispatch builds on them and the step-4 commit captures them.

d. **Then finish the run** — steps 5–8 exactly as a fresh run, using the `<starting>` from (a) throughout. Step 8 now unwinds to the real base, so the run returns to `<starting>` instead of stranding HEAD on the work branch.

## Mutant budget

- Small domains (<~300 LOC): 8–12 mutants.
- Medium (~300–800 LOC): 10–14.
- Large (~800+ LOC dense): 14–20.
- **Hard cap: 20 per agent.** If 20 leave high survival, dispatch a follow-up agent rather than drifting past.
- Productive expansion (~50%: 8→12, 12→18) is fine when high-value mutations exceed budget. The cap is the brake; the budget is the suggestion.
- Big imbalance (one domain wants 40, another 5) is a grouping signal — split or merge before dispatch.

## Non-applicable mutations are healthy

Agents flag a mutation as "non-applicable" when:
- The mutated function is unexported / private to the file.
- The branch is defensive code no current input reaches.
- The path is render-only or pure-logging (no observable simulation effect).
- The mutation is an equivalent transformation (e.g., `>= 1` → `> 1` when both branches return the same value at the boundary).

Non-applicable is a legitimate outcome, not a survivor. Agents must NOT contrive tests to cover non-applicable mutations — that's how implementation-detail pins enter the suite.

Many non-applicables (4+ in a 10-mutation budget) signal heavy defensive/render-only code — a finding for the agent to report, not an orchestrator problem.

## Pruning low-value tests

Each agent runs an embedded pruning scan as its last step (post-strengthening within its domain). Cross-domain test obviation is rare under exclusive ownership, so a separate orchestrator-side pruning pass usually isn't needed.

How candidates are generated — the candidate taxonomy and the Don't-prune rules — is defined in the agent prompt's "Pruning scan" section; the orchestrator does not generate candidates, it walks the agent's already-classified Safe-delete/Review/Keep report (step 7).

Classify each candidate:
- **Safe-delete** — a named sibling catches the same mutants; remove candidate, re-apply mutation, sibling still kills it.
- **Review** — looks low-value but proof incomplete. Report; do not propose deletion.
- **Keep** — the only guard for a user-visible behavior, boundary, regression, or reachable code path.

If pruning empties a test file, delete the file too. Surface it during the user walk-through.

Approval cadence: see Workflow step 7.

## Agent prompt template

Send this to each subagent. Substitute every `<...>` placeholder in the template body before sending: `<domain name>`, `<test files>`, `<source files>`, and `<mutant budget>` (the per-domain count from `## Mutant budget` — small=8–12, medium=10–14, large=14–20). **If the project has `dev/code-rules/testing.md`, splice it into the two placeholder sections at the bottom (`Project conventions` and `Per-domain gotchas`) per the rules in `## Per-domain gotchas (orchestrator instructions)` below — not as a single blob.**

```
You are doing **mutation testing** on the <domain name> code.

## Goal

Verify that <test files> actually catch small logic errors in the production code. For each mutant the tests miss (a "survivor"), either strengthen the test or fix the code if a real bug surfaced.

## Scope (exclusive ownership)

- **Test file(s):** <test files>
- **Source file(s) you may mutate:** <source files>

Do NOT mutate any other file. The orchestrator runs one agent at a time across multiple domains; staying inside your assigned source files keeps attribution clean.

## Workflow per mutant

1. **Read each source file end to end** before picking mutants. Read the test file(s) too — focus on logic those tests actually observe.
2. For each candidate mutation:
   a. Apply with Edit (one mutation at a time).
   b. Run the relevant test file **under a hard timeout** — in this repo `dev/run-test-file.sh <test file>` (wraps `tsx` with a generous timeout and kills the whole process tree if it hangs); elsewhere wrap the runner yourself, e.g. `gtimeout 600 pytest <test file>` / `timeout 600 cargo test <name>`. Always bound the run: a mutation can make a loop never terminate (the comparison and arithmetic flips below are common causes), and an unbounded runner then hangs forever — leaving orphaned processes — instead of returning. Killed = non-zero exit (a timed-out run counts as killed). Survived = zero exit.
   c. **Revert and verify the chained check.** Edit back, then BOTH (i) `git diff -- <source files>` (list ALL owned source files explicitly, e.g. `git diff -- src/foo.ts src/bar.ts` — singular `git diff <source file>` returns empty when you accidentally edited a different owned file, false-passing the check) returns empty AND (ii) re-run the test, exit 0. If either fails, STOP — do `git checkout -- <source files>`, re-run until both pass before continuing. A drifted file silently turns the next "killed" into a phantom kill (or "survived" into a phantom survivor).
   d. Do not move to the next mutation until both checks pass.
   e. **If you commit a real bug fix mid-session** (per Handling survivors below), commit it to the work branch BEFORE proceeding to the next mutation: `git add -- <source files> && git commit -m "fix: <bug>"`. Otherwise the bug fix stays in the working tree and the next mutation's chain check (i) will see the bug-fix diff and fail — and `git checkout -- <source files>` would discard your fix.

## Mutation strategy

Generate **<mutant budget> candidates** focused on observable logic. Pick from:

- Comparison flips: `<` ↔ `<=`, `>` ↔ `>=`, `===` ↔ `!==`, `<` ↔ `>`
- Boolean swaps: `&&` ↔ `||`
- Arithmetic flips: `+` ↔ `-`, `*` ↔ `/`, off-by-one (`+1` → `-1`)
- Constants: swap a meaningful constant, `0` → `1`, `true` → `false`
- Conditional inversion: `if (x)` → `if (!x)`
- Boundary: `Math.max` ↔ `Math.min`, `Math.floor` ↔ `Math.ceil`
- Removing an early-return guard
- Skipping a side effect (e.g., not pushing to an array, not incrementing a counter)
- Loop-bound off-by-one
- Loop-index pinning (`array[i]` → `array[0]` — survives single-element tests)
- Swapping argument order in critical calls
- Return-value mutations (return wrong branch / wrong variable)
- **Paired-branch coverage**: when source uses a paired condition (`x > y`, OR `||`, x/y axis), check the test catches the symmetric case too. Asymmetric branch coverage is the most common test gap.
- **Range-boundary tests**: place an event AT the boundary when source compares against cutoff/capacity. Well-inside or well-outside values won't catch a `<` ↔ `<=` flip.
- **`Math.max(0, ...)` clamps**: swap for bare `x` — common survivor when tests cover only the happy non-negative path.
- **Set/Map.add side-effect skip**: drop a `takenIds.add(...)` or `cache.set(...)` — survivor when tests don't assert uniqueness across many generated items.
- **Regex flag changes**: drop `g`/`i` from a `/pattern/g`. Single-occurrence inputs miss this.
- **`await` removal**: drop `await` on a single call — survives when test doesn't observe the awaited result.
- **Other operator swaps**: `??` and `||` fallback swaps, optional-chain removal (`?.` → `.`), sort comparator flips (`a - b` → `b - a`), nullish-coalesce argument-order swaps (`a ?? b` → `b ?? a`), object-key swaps in same-typed positions.
- **Public-API entry points over internal helpers**: prefer mutating logic reachable through the public API. Mutations to internal helpers may be non-applicable if assigned tests only call the public API.

Skip mutations whose effect can't be detected by assigned tests (pure logging, render-only paths, dead branches, defensive guards no input reaches). Note as "non-applicable" rather than survivors.

## Handling survivors

For each survived mutant, decide between strengthening the test and fixing the code:

- **Strengthen the test if:** original code was correct and the mutation is a contrived alternative behavior the test happens not to observe (untested boundary; `Math.max` ↔ `Math.min` swap on always-in-range data; defensive code path tests can't reach).
- **Fix the code if:** mutation produces behavior surrounding code relies on (a missing `Math.max(0, x)` clamp lets a counter go negative, breaking a downstream availability calc; a missing `takenIds.add(id)` lets two records share an id, breaking a registry lookup).
- **Decision rule:** ask "does any other code in the system already trust the un-mutated behavior to hold?" If yes → real bug, fix the code. If no → test gap, strengthen the test.

**Don't** add an assertion pinning internal storage shape — array lengths on private observer registries, cache `.size`, the order of the current random shuffle. Test the public contract (call the API, observe the result) instead. When unsure, lean toward strengthening; bug fixes carry more risk than test additions.

**Comment style for strengthened tests.** When adding an assertion or test to kill a survivor, write a one-sentence comment naming the specific mutation it pins. Format: `// Pin <X>. <Mutation> would <observable failure>.`

**New test files are OK** when a survivor doesn't fit any existing one — create in the same test directory. Splitting a long existing test file for tidiness is a structural call — propose in the report, don't execute autonomously.

## Pruning scan

After resolving survivors, scan the assigned test files for prunable tests. Cap at ~5 candidates per agent. Report under a "Pruning candidates" heading separate from survivors.

**A test is a candidate when at least one holds AND a named sibling provably catches what it does:**
- **Subset of a stronger sibling** — every assertion is also made by another test on a longer path.
- **Tautological / setup-restating** — assertion only proves what setup just assigned.
- **Implementation-detail pin** — asserts on private collection size, helper call order, or cached internals (`array.length === 0`, `Map.size`, observer registry layout) instead of behavior.
- **Orphan path** — branch under test is unreachable from the current data files (e.g. a dedup branch when the data files have no duplicates).
- **Setup-heavy / payoff-thin** — large fixture protects a trivial outcome already covered.
- **Comment-restating without scenario** — assertion only restates setup. (Setup narration is fine; the issue is the assertion.)
- **Symmetric-axis duplicate** — two tests pass through the same production branch and kill the same mutants (e.g. x-only and y-only variants when production code is field-wise symmetric).

**Classify each candidate:**
- **Safe-delete** — perform the proof: temporarily remove the candidate, re-apply a mutation the candidate used to kill, run the sibling test, confirm sibling still kills it, then RESTORE the candidate (final tree must contain all original tests — orchestrator deletes at step 7 after user approval). Report the sibling test name + line and the specific mutation used.
- **Review** — looks low-value but proof incomplete or no clean sibling. Report; do not propose deletion.
- **Keep** — the only guard for a user-visible behavior, boundary, regression, or reachable code path.

**Don't:** prune to fit a budget; prune tests added or strengthened in THIS run; prune because it "feels redundant" without naming the sibling + mutants both would catch; prune scenario-narration tests in user-flow files just for shared setup (symmetric-axis duplicates ARE candidates; named distinct user actions are NOT); prune boundary tests (off-by-one / empty-input / single-element).

The agent does NOT permanently delete any test file — the Safe-delete proof restores everything. The orchestrator handles real deletion at step 7 after user approval.

## Final state

The working tree's `git diff` must contain ONLY strengthened test code in YOUR assigned test files. Real bug fixes (per Workflow per mutant step 2e) are already committed — they are not in the working tree.

NO stray mutations, NO edits to files outside your assigned scope. Verify with `git diff -- <source files>` empty (substitute YOUR assigned source files explicitly — not all source files in the repo) and `git diff -- <test files>` showing only your intentional strengthening — plus `git status --porcelain -- <test dirs>` to surface any NEW test files you created, since `git diff` does not list untracked files and the orchestrator needs their paths to stage them at its step 4. Then run the test file(s) for your domain (NOT the full suite — other domains' tests are out of scope and may be flaky for unrelated reasons). The orchestrator commits your changes immediately at its step 4 (no approval gate — the work branch is throwaway) and runs the full suite at its step 6 — any stray mutation gets committed verbatim and poisons the next agent's baseline.

## Reporting format

Return:

```
# Domain: <name>

## Baseline
✓ <test files> pass before mutations

## Mutations tried (N total)

| # | File:Line | Mutation (before → after) | Result | Re-run command |
|---|-----------|---------------------------|--------|----------------|
| 1 | `src/foo.ts:142` | `< amount` → `<= amount` | killed | `dev/run-test-file.sh tests/foo.test.ts` |
| 2 | `src/foo.ts:88` | dropped `takenIds.add(id)` | non-applicable (private helper, no test reaches it) | — |
...

Result column values: `killed` / `survived` / `non-applicable` (with parenthetical reason).

## Survivors and resolutions

### Survivor 1: <one-line summary>
- **Location:** `src/foo.ts:142`
- **Mutation:** `< amount` → `<= amount`
- **How to reproduce:** apply mutation, then `<test command>` exits 0
- **Resolution:** strengthened `tests/foo.test.ts:88` (added boundary case)
- **Confidence:** high / medium / low (gap is real / could be borderline non-applicable / unsure)

## Pruning candidates (N total)

### Safe-delete: <test name>
- **File:** `tests/foo.test.ts:42`
- **Why prunable:** subset of stronger sibling `tests/foo.test.ts:88 'full happy path'`
- **Proof:** removed candidate, re-applied mutation `src/foo.ts:142 < → <=`, sibling at line 88 still killed it, restored candidate.

### Review: <test name>
- **File:** `tests/foo.test.ts:60`
- **Why suspected prunable:** tautological — assertion only restates setup
- **Why not Safe-delete:** no clean sibling covers this setup case; orchestrator should walk with user.

### Keep: <test name>
- **File:** `tests/foo.test.ts:120`
- **Why surfaced:** boundary case for `x === 0`; not subsumed by general-case tests.

(Omit any tier with zero entries.)

## Final test run
<test command for assigned tests only>: X passed, 0 failed

## Files changed
- tests/... (strengthening; deletions only if you removed a test file's last test)
- src/...ts (bug fixes only, if any — these are already committed per workflow step 2e)

## Summary footer (orchestrator-greppable)
SUMMARY: <mutations> tried, <killed> killed, <survived> survived, <non-applicable> non-applicable, <test-strengthenings> tests strengthened, <bug-fixes> source fixes, <pruning-candidates> pruning candidates (<safe-delete>/<review>/<keep>).

Note: `tried = killed + survived + non-applicable` — non-applicables are reported separately so the arithmetic closes.
```

If you have **zero survivors**, report it honestly. Don't manufacture findings.

## Project conventions

<Orchestrator inserts "Project conventions to add to each agent prompt" from `dev/code-rules/testing.md` here, if it exists. Otherwise empty and the agent relies on project-local coding rules.>

## Per-domain gotchas

<Orchestrator inserts the matching bullet from `dev/code-rules/testing.md` § "Per-domain gotchas" here based on the assigned domain. If no file or no match, empty.>
```

## Per-domain gotchas (orchestrator instructions)

If the project has `dev/code-rules/testing.md` with a `## Per-domain gotchas` section, the orchestrator matches each dispatched domain to a bullet at dispatch time and splices the matching bullet into the agent prompt's `<Per-domain gotchas>` placeholder. Matching:

- Bullet headers are domain keywords (e.g. `- **trade**:`, `- **economy/station**:`, `- **render**:`).
- Match each dispatched domain to a bullet by the `<name>` slug from step 2e or by primary source-file prefix (e.g. domain `sim-trade` → `**trade**:` bullet).
- A domain that matches no bullet leaves the placeholder empty — replace the entire `<Per-domain gotchas>` tag with a blank line (don't leave the literal `<>` tag in the agent prompt — an LLM agent could read it as an instruction).
- Same applies to `<Project conventions>`: if `dev/code-rules/testing.md` has no `## Project conventions to add to each agent prompt` section, replace the tag with a blank line.

## Why sequential, not parallel

Worktree-parallel has three failure modes, all sidestepped by sequential dispatch in the main checkout:

1. **Worktree-base divergence** — the harness sometimes branches from `origin/main`, not the local work branch; after a local rename/move, agents see OLD paths and `git apply` rejects at integration.
2. **Isolation bypass** — agents sometimes resolve absolute paths to the origin repo and write there; worktree diff is empty (auto-cleaned) while main repo `git status` shows surprise test-file changes.
3. **User policy** — many users (default CLAUDE.md included) ban `git worktree` without explicit permission.

Wall time is ~N× longer for N domains; the trade-off buys correctness.

## Parallel-worktree mode (opt-in)

If user explicitly opts in (e.g. "use worktrees, I'm fine with the trade-off"):

- **Step 3 (dispatch):** dispatch all agents in parallel with `isolation: "worktree"`.
- **Verify base BEFORE agents do real work:** as soon as worktrees exist, run `git -C <worktree> rev-parse HEAD` for each and compare against the work-branch tip (`git rev-parse review-tests-wip-<id>`). If any differs, the harness anchored elsewhere (commonly `origin/main`) — abort that agent and warn the user that worktree-base divergence will produce patches that won't apply. Don't let agents burn budget on a stale base.
- **Discover worktree paths:** use `git worktree list --porcelain` to enumerate active worktrees (don't assume a hardcoded path like `.claude/worktrees/agent-<id>` — the harness may place them elsewhere).
- **Step 4 (integration):** generate per-worktree patches — first `git -C <worktree> add -N -A` so agent-created new test files are included (a bare `git diff HEAD` omits untracked files), then `git -C <worktree> diff HEAD > /tmp/agent-<id>.patch` — and apply each as a SEPARATE commit on the work branch with the per-agent commit message from step 4 (preserving per-agent attribution). Apply with `git apply --3way`. If `--3way` rejects (two patches touched the same line), surface both patches to the user — do NOT skip silently; the rejected agent's work is undeployed.
- **Cleanup at step 8:** for each path returned by `git worktree list --porcelain`, FIRST run `git -C <worktree> status --porcelain`: if any `??`-prefixed test files remain (an agent-created test the patch step missed), surface and capture them before removing — otherwise they're destroyed with no reflog. Then `git worktree remove --force <path>`. If the worktree is locked (`git worktree list` shows `locked`), run `git worktree unlock <path>` first (NOT a second `--force` — `--force` does not bypass locks). `worktree remove` refuses when a worktree has modified OR untracked files and `--force` overrides that refusal, so the `git add -N -A` patch step above plus this `status` check are what stop the override from silently dropping a new test file.
- **When worktree-base divergence hits:** be ready to manually port test additions (agents wrote them against the stale anchor's filenames; patches reject for renamed/moved paths). The base-verification step above catches this proactively.

## Why a work branch

- Integration leaves a window of uncommitted state between agent return and commit; working-tree operations (sync tools, snapshots, manual reverts, a stray `git checkout`) can erase it silently with no reflog trace. The work branch closes the window — each integration commits immediately (no gate; throwaway branch that never reaches `<starting>`, which stays untouched).
- It preserves pre-existing uncommitted state as a WIP commit (step 0.5) so agents see it; step 8 unwinds it via path A or path B.
- Resumable: an aborted run leaves the work branch; step 0.5 detects it and offers resume/delete.

## Why exclusive source-file ownership

- Sequential dispatch already removes the write race, but exclusive ownership still gives clean per-commit attribution (each commit names its domain) and balances workloads (each domain owns a coherent LOC slice); without it, two agents pick overlapping mutations and waste budget on the same surface.
- When tests share a source file, fold them into one domain rather than splitting — larger but correct beats split.

## Context management

- **Target ≤200K.** The orchestrator holds only per-agent summaries between dispatches — agents read source in isolation — so context stays light even across many domains. Anchor on 200K even on 1M-context models.
- If context climbs across a long run, `/clear`: the work branch (step 0.5) plus orphan-branch detection resume the run — re-running detects the `review-tests-wip-*` branch and offers resume/delete.
