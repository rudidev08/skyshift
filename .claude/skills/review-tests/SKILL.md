---
name: review-tests
description: "[rp] Mutation-test specified tests via sequential subagents — apply logic mutations to source, strengthen tests against survivors (or fix bugs the mutations expose), propose pruning candidates"
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

- Re-running on the same scope is a convergence test, not a duplicate. Expect FEWER survivors and DIFFERENT mutation classes vs. prior run, not zero.
- Non-decreasing survivor count is fine. *Increasing* count on the same domain is the warning sign — ask the user whether the prior run's strengthening was committed to `<starting>` (the skill hands changes back uncommitted at step 8 and the user writes their own commit messages, so a `git log` grep for `agent <domain>:` won't find anything even after a successful prior run). If the user confirms the prior strengthening landed and survivors still went up, a third run is warranted.

## Files to test

`$ARGUMENTS`

If empty, ask the user which tests to mutate (named files, a directory, or "all").

## Workflow

0. **Pre-flight green baseline.** Run the project's test command (`npm test`, `cargo test`, `pytest`, etc.) and confirm all tests pass. Mutation testing assumes a clean baseline. Dirty `git status` is OK — step 0.5 captures it.

0.5. **Create the work branch.** Do these in order; later steps depend on earlier ones:
   - **Capture starting branch:** run `git rev-parse --abbrev-ref HEAD` and **remember the value**. Substitute this name into every `<starting>` reference in later steps — Bash invocations get fresh shells, so a `STARTING=...` shell variable does not persist.
   - **Refuse if detached HEAD:** test with `git symbolic-ref -q HEAD` (exit code 1 = detached). If detached, surface to the user and stop. (`git rev-parse --abbrev-ref HEAD` returns the literal string `HEAD` in this state — don't treat that as a branch name.)
   - **Refuse if in-progress merge/rebase/cherry-pick:** check for `.git/MERGE_HEAD`, `.git/rebase-merge/`, `.git/rebase-apply/`, `.git/CHERRY_PICK_HEAD`, or any `git ls-files -u` output. If present, surface to the user and stop — committing through unresolved conflict markers would corrupt both the work branch and the user's in-progress operation.
   - **Detect orphan work branches BEFORE creating new one:** `git branch --list 'review-tests-wip-*'`. If any exist, surface and ask user to delete or resume. Don't auto-resolve. (Order matters: doing this AFTER `checkout -b` would always match the just-created branch.)
   - **Create the work branch:** `git checkout -b review-tests-wip-<id>` (short timestamp or random id).
   - **If `git status` was dirty:** use `git add -u && git commit -m "WIP: pre-skill working state"` — stages only modified TRACKED files. Then surface untracked files (`git ls-files --others --exclude-standard` — exits 0 whether the list is empty or not) to the user and ask which (if any) to include in a follow-up `git add <files> && git commit --amend --no-edit`. Never blanket-`-A` — that sweeps `.env`, scratch dirs, `*.local.md` drafts, and other intentionally-untracked content into the WIP commit and onto `<starting>` at step 8 unwind.

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

4. **Per-agent integration (between agents).**
   - Inspect: `git status --porcelain` and `git diff --stat`. Source changes mean an explicit bug fix (verify vs. report) or a stray mutation; surprise files are speculative cleanup that doesn't belong.
   - Read the agent's summary; verify survivor count and resolutions.
   - Apply any code fixes the agent flagged as real bugs (rare — most survivors are test gaps).
   - **Commit immediately to the work branch** — no approval prompt needed (work branch is throwaway).
     Commit message: `agent <domain>: <T> tests strengthened (<X> mutations, <Y> killed, <Z> source fixes)` where `<T>` is the count of strengthened tests, `<X>` total mutations tried, `<Y>` killed by the unmodified suite, `<Z>` real bug fixes the agent committed. No run-number prefix — re-runs are tracked by the user's invocation count, not by commit metadata; the Convergence check (above) reads prior `agent <domain>:` commits from `<starting>` to detect re-runs.
   - Confirm working tree clean before dispatching the next agent.

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
     - **B (WIP exists, user wants boundary preserved):** the work branch keeps everything; just step off and rename. `git checkout <starting>` (the work branch's WT is clean from the last integration commit, so the checkout switches HEAD cleanly), then `git branch -m review-tests-wip-<id> review-tests-prior-<id>`. The user's working tree is now clean on `<starting>` — the pre-skill WIP and the skill's strengthening both live on `review-tests-prior-<id>` only. **Tell the user explicitly:** "Your pre-skill edits are NOT in the working tree anymore — they're on `review-tests-prior-<id>` as commit `<wip-sha>`. To restore them as uncommitted edits: `git checkout review-tests-prior-<id> -- .` then `git restore --staged .`." Give them two diff commands using the captured `<wip-sha>` from the warning above: `git diff <starting>..<wip-sha>` shows only the WIP; `git diff <wip-sha>..review-tests-prior-<id>` shows only the skill's strengthening + prunings + any agent `fix:` commits. User cleans up `review-tests-prior-<id>` when done.
   - Either way: skill does NOT commit or push to `<starting>`; user reviews and commits when ready.

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

A test is a pruning candidate when at least one holds AND a named sibling provably catches what it does:

- **Subset of a stronger sibling** — every assertion is also made by another test on a longer path.
- **Tautological / setup-restating** — assertion only proves what setup just assigned.
- **Implementation-detail pin** — asserts on private collection size, helper call order, or cached internals (`array.length === 0`, `Map.size`, observer registry layout) instead of behavior.
- **Orphan path** — branch under test is unreachable from current authored data (e.g. a dedup branch when current data has no duplicates).
- **Setup-heavy / payoff-thin** — large fixture protects a trivial outcome already covered.
- **Comment-restating without scenario** — assertion only restates setup. (Setup narration is fine; the issue is the assertion.)
- **Symmetric-axis duplicate** — two tests pass through the same production branch and kill the same mutants (e.g. x-only and y-only variants when production code is field-wise symmetric).

Classify each candidate:
- **Safe-delete** — a named sibling catches the same mutants; remove candidate, re-apply mutation, sibling still kills it.
- **Review** — looks low-value but proof incomplete. Report; do not propose deletion.
- **Keep** — the only guard for a user-visible behavior, boundary, regression, or reachable code path.

**Don't:**
- Prune to fit a budget. Zero candidates is fine; 5 contrived ones is not.
- Prune tests added or strengthened in THIS run.
- Prune because it "feels redundant." Point at the specific sibling and the specific mutants both would catch.
- Prune scenario-narration tests in user-flow files just for shared setup. Symmetric-axis duplicates ARE candidates; named distinct user actions are NOT.
- Prune around boundary tests (off-by-one / empty-input / single-element). Rarely subsumed by general-case tests.

If pruning empties a test file, delete the file too. Surface it during the user walk-through.

Approval cadence: see Workflow step 7.

## Agent prompt template

Send this to each subagent. Substitute every `<...>` placeholder in the template body before sending: `<domain name>`, `<test files>`, `<source files>`, and `<mutant budget>` (the per-domain count from `## Mutant budget` — small=8–12, medium=10–14, large=14–20). **If the project has `dev/code-rules/testing.md`, append its contents to the Project conventions section at the bottom before sending.**

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
   b. Run the relevant test file (e.g. `npx tsx <test file>`, `cargo test <name>`, `pytest <test file>`). Killed = non-zero exit. Survived = zero exit.
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
- **Implementation-detail pin** — asserts on private collection size, helper call order, cached internals (`array.length === 0`, `Map.size`, observer registry layout) instead of behavior.
- **Orphan path** — branch under test is unreachable from current authored data.
- **Setup-heavy / payoff-thin** — large fixture protects a trivial outcome already covered.
- **Comment-restating without scenario** — assertion only restates setup.
- **Symmetric-axis duplicate** — two tests pass through the same production branch and kill the same mutants (e.g. x-only and y-only variants when production code is field-wise symmetric).

**Classify each candidate:**
- **Safe-delete** — perform the proof: temporarily remove the candidate, re-apply a mutation the candidate used to kill, run the sibling test, confirm sibling still kills it, then RESTORE the candidate (final tree must contain all original tests — orchestrator deletes at step 7 after user approval). Report the sibling test name + line and the specific mutation used.
- **Review** — looks low-value but proof incomplete or no clean sibling. Report; do not propose deletion.
- **Keep** — the only guard for a user-visible behavior, boundary, regression, or reachable code path.

**Don't:** prune to fit a budget; prune tests added or strengthened in THIS run; prune because it "feels redundant" without naming the sibling + mutants both would catch; prune scenario-narration tests in user-flow files just for shared setup (symmetric-axis duplicates ARE candidates; named distinct user actions are NOT); prune boundary tests (off-by-one / empty-input / single-element).

The agent does NOT permanently delete any test file — the Safe-delete proof restores everything. The orchestrator handles real deletion at step 7 after user approval.

## Final state

The working tree's `git diff` must contain ONLY strengthened test code in YOUR assigned test files. Real bug fixes (per Workflow per mutant step 2e) are already committed — they are not in the working tree.

NO stray mutations, NO edits to files outside your assigned scope. Verify with `git diff -- <source files>` empty (substitute YOUR assigned source files explicitly — not all source files in the repo) and `git diff -- <test files>` showing only your intentional strengthening. Then run the test file(s) for your domain (NOT the full suite — other domains' tests are out of scope and may be flaky for unrelated reasons). The orchestrator commits your changes immediately at its step 4 (no approval gate — the work branch is throwaway) and runs the full suite at its step 6 — any stray mutation gets committed verbatim and poisons the next agent's baseline.

## Reporting format

Return:

```
# Domain: <name>

## Baseline
✓ <test files> pass before mutations

## Mutations tried (N total)

| # | File:Line | Mutation (before → after) | Result | Re-run command |
|---|-----------|---------------------------|--------|----------------|
| 1 | `src/foo.ts:142` | `< amount` → `<= amount` | killed | `npx tsx tests/foo.test.ts` |
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

Worktree-parallel mode has three failure modes in practice:

1. **Worktree-base divergence** — the worktree harness sometimes branches from `origin/main` rather than the local work branch. Agents see OLD paths when a local refactor renamed/moved files; tests reference helpers under old names; `git apply` rejects at integration time.
2. **Isolation bypass** — agents sometimes resolve absolute file paths to the originating repo and write there directly. Worktree diff is empty (auto-cleaned); main repo `git status` shows unexpected test-file changes.
3. **User policy** — many users (including the default CLAUDE.md template) ban `git worktree` use without explicit permission.

Sequential dispatch in the main checkout sidesteps all three. Wall time is ~N× longer for N domains; the trade-off buys correctness.

## Parallel-worktree mode (opt-in)

If user explicitly opts in (e.g. "use worktrees, I'm fine with the trade-off"):

- **Step 3 (dispatch):** dispatch all agents in parallel with `isolation: "worktree"`.
- **Verify base BEFORE agents do real work:** as soon as worktrees exist, run `git -C <worktree> rev-parse HEAD` for each and compare against the work-branch tip (`git rev-parse review-tests-wip-<id>`). If any differs, the harness anchored elsewhere (commonly `origin/main`) — abort that agent and warn the user that worktree-base divergence will produce patches that won't apply. Don't let agents burn budget on a stale base.
- **Discover worktree paths:** use `git worktree list --porcelain` to enumerate active worktrees (don't assume a hardcoded path like `.claude/worktrees/agent-<id>` — the harness may place them elsewhere).
- **Step 4 (integration):** generate per-worktree patches (`git -C <worktree> diff HEAD > /tmp/agent-<id>.patch`) and apply each as a SEPARATE commit on the work branch with the per-agent commit message from step 4 (preserving per-agent attribution). Apply with `git apply --3way`. If `--3way` rejects (two patches touched the same line), surface both patches to the user — do NOT skip silently; the rejected agent's work is undeployed.
- **Cleanup at step 8:** for each path returned by `git worktree list --porcelain`, run `git worktree remove --force <path>`. If the worktree is locked (`git worktree list` shows `locked`), run `git worktree unlock <path>` first (NOT a second `--force` — `--force` does not bypass locks). Double `--force` exists only to override the modified-files check, which `--3way` integration leaves clean anyway.
- **When worktree-base divergence hits:** be ready to manually port test additions (agents authored against the stale anchor's filenames; patches reject for renamed/moved paths). The base-verification step above catches this proactively.

## Why a work branch

- Integration creates a window of uncommitted state between agent return and commit. Working-tree-level operations (external sync tools, pause/resume snapshots, manual reverts, a working-tree `git checkout`) can erase work silently, with no reflog trace.
- Work branch closes the window: each integration commits immediately to the work branch (no approval gate, since the branch is throwaway and never reaches the starting branch). Starting branch untouched throughout.
- Work branch preserves pre-existing uncommitted state as a WIP commit (step 0.5) so agents see it. Step 8 either (A) unwinds WIP + strengthening together as one unstaged diff on `<starting>` or (B) renames the work branch to `review-tests-prior-<id>` so the WIP↔strengthening boundary stays inspectable as separate commits. User commits when ready.
- Flow is resumable: aborted skill leaves the work branch; re-run detects via step 0.5 and surfaces resume/delete choice.

## Why exclusive source-file ownership

- Sequential dispatch eliminates the race condition, but exclusive ownership still: (a) gives clean attribution (each commit names its agent/domain) and (b) balances workloads (each domain owns a coherent LOC slice).
- Without it, two agents would pick overlapping mutations and waste budget on the same surface.
- When tests share a source file, fold into one domain rather than splitting. Larger but correct beats split.
