---
name: review-tests
description: "[lav] Mutation-test specified tests via sequential subagents — apply logic mutations to source, strengthen tests against survivors (or fix bugs the mutations expose), propose pruning candidates"
---

# Review Tests (Mutation Testing)

Orchestrate mutation testing across the test files the user passes in. One focused subagent per domain (a test file plus the exclusive source files it covers). Each agent applies ~10 small logic mutations to the source code, runs its test file, and records which mutants the tests fail to catch ("survivors"). Survivors get either a strengthened test or — if the mutation revealed a real bug — a code fix.

Default execution is **sequential** in the main checkout — one agent at a time. The user can opt into parallel-worktree mode if they explicitly want it; see "Why sequential, not parallel" below.

This skill is **user-initiated**: only run when explicitly invoked (via `/review-tests` or a direct request to mutation-test specific tests).

## Convergence on re-run

Running the skill twice on the same scope is a healthy convergence test, not a redundancy. The expected pattern after one round of strengthening:

- Some domains return **zero survivors** — the strengthening landed and the obvious gaps are closed.
- Some domains return **new survivors** — agents pick different mutations on a re-run (different operator, different boundary, different file) and surface gaps the first pass missed.

A non-decreasing survivor count between runs is fine. The warning sign is *increasing* survivor count on the same domain — either the strengthening didn't apply (verify the diff is in the work branch) or the suite has multiple distinct gap surfaces and a third run is warranted.

Don't expect Run #N to find zero survivors. Expect it to find FEWER survivors than Run #N-1 and to flag DIFFERENT mutation classes.

## Files to test

`$ARGUMENTS`

If `$ARGUMENTS` is empty, ask the user which tests to mutate (named files, a directory, or "all"). Don't pick autonomously — the budget is dozens of mutants total, not hundreds.

## Workflow

0. **Pre-flight: green baseline.** Before dispatching any agents, run the project's test command (`npm test`, `cargo test`, `pytest`, etc.) and confirm all tests pass. Mutation testing assumes a clean baseline — a pre-existing failure produces phantom survivors. Dirty `git status` is OK — step 0.5 commits any uncommitted state to the work branch so agents see it.

0.5. **Create the work branch.** All integration commits during the skill go to a temporary branch, not the starting branch. This isolates work-in-progress from the user's primary branches, preserves any pre-existing uncommitted state, and means a pause/interruption can never lose work.
   - Capture the starting branch: `STARTING=$(git rev-parse --abbrev-ref HEAD)`.
   - Refuse to start if `STARTING` is detached HEAD — surface to the user.
   - Generate a short id (timestamp or random) and create the work branch: `git checkout -b review-tests-wip-<id>`.
   - **If `git status` was dirty**, commit the uncommitted state on the work branch as a single "WIP for mutation testing" commit (`git add -A && git commit -m "WIP: pre-skill working state"`). This carries the user's in-progress work forward so agents see it. Step 8 unwinds this commit on hand-back.
   - Detect orphan work branches from prior aborted runs (`git branch --list 'review-tests-wip-*'`). If any exist, surface them and ask the user whether to delete or resume. Don't auto-resolve.

1. **Resolve the file list** from `$ARGUMENTS` or the user's clarification. Confirm the scope before dispatching when it's broad.

2. **Map tests to source files mechanically.**
   a. For each test file, extract imports (e.g. `grep -E "^import.*from \"\.\." <test>` for TS/JS). Resolve each relative import to its concrete path under the project's source root (e.g. `../foo.ts` → `src/foo.ts`).
   b. **Trace through fixture files.** When a test imports a fixture (`*-test-fixtures.ts`, `factories.ts`, `conftest.py`), open the fixture and follow ITS imports — those source files are part of the test's coverage scope.
   c. Build a `Map<source-file, test-files-that-import-it>`. Any source file with ≥2 importers forces those tests into a single domain (exclusive source-file ownership: no source file may be mutated by two agents).
   d. After resolving forced groupings, balance domain size by source-file LOC, not test-file count. Aim for similar total LOC per domain — pairing a large dense cluster (e.g. 2000 LOC) with a tiny pure-transform file (e.g. 100 LOC) under one agent wastes the small file's budget.
   e. Print the mapping (`Domain N: <test files> → <source files> (~N LOC)`) for user sanity-check before dispatch.
   f. Agent count is fallout from steps 2c–2d, not a target. Sane range 3–10. Below 3 → likely over-merged (split the largest domain); above 10 → likely over-split (fold the smallest into a sibling).

3. **Dispatch subagents sequentially** using the prompt template below. One agent at a time in the main checkout — no `isolation: "worktree"`. After each agent finishes, integrate its findings (step 4) before launching the next. Sequential is the trade-off for working in the main checkout: agents can't clobber each other's source-file mutations, and the agents see the work branch's actual HEAD (including any pre-existing uncommitted state committed in step 0.5).

   Why not parallel: parallel agents would all be writing to the same files at once, which corrupts test runs (`agent A mid-mutation on sim-station.ts` poisons `agent B`'s test that imports it transitively). Worktree isolation would fix that but is blocked by user policy in many setups. Sequential is the safe default. Wall time is ~N× longer for N agents; the user can opt into worktree-parallel mode explicitly if they want it.

4. **Per-agent integration (between agents).** When each agent returns:
   - Inspect the working tree: `git status --porcelain` and `git diff --stat`. Source changes mean either an explicit bug fix (verify it matches the agent's report) or a stray mutation that wasn't reverted; surprise files are speculative cleanup that doesn't belong.
   - Read the agent's summary; verify the survivor count and resolutions.
   - Apply any code fixes the agent flagged as real bugs (rare — most survivors are test gaps).
   - **Commit immediately to the work branch.** No approval prompt needed — the work branch is not main. Commit message: `Run #N agent <domain>: <N> tests strengthened (<X> mutations, <Y> killed, <Z> source fixes)`.
   - Confirm the working tree is clean before dispatching the next agent.

5. **Final integration check.** After all agents have run and their changes are committed:
   - Verify `git log --oneline <starting>..HEAD` shows the WIP commit (if any) plus one strengthening commit per agent.
   - Verify `git diff <starting>..HEAD --stat` reports only test-file changes plus any intentional source bug fixes.

6. **Validate the integrated state.** Run the project's full test command, type checker, and linter on the work branch — all must pass before continuing. If any fail, debug and fix in a follow-up commit on the work branch (don't unwind the prior commit).

7. **Walk pruning candidates with the user.** Each agent's report has a "Pruning candidates" section with three tiers:
   - **Safe-delete** — sibling test catches the same mutants. Batch all Safe-delete candidates into one user-confirmation. After approval, delete in a single commit on the work branch.
   - **Review** — looks low-value but proof is incomplete. Walk one-by-one with the user. Each is a judgment call; don't intermix with the Safe-delete batch. Approved deletes go into a separate commit (or fold into the same commit as Safe-deletes if the user prefers).
   - **Keep** — surfaced for transparency; no action.

8. **Hand the work branch back as uncommitted changes.** The skill never commits to the user's starting branch. All work-branch commits get unwound on hand-back; the user commits when they're ready.
   - Show the user `git log --oneline <starting>..HEAD` (WIP commit, if any, plus per-agent strengthening commits, plus any pruning commits).
   - Get explicit approval before unwinding.
   - On the work branch: `git reset --soft <starting>` (rewinds HEAD to `<starting>`, keeps all changes staged).
   - `git restore --staged .` (unstages everything; working tree unchanged).
   - `git checkout <starting>` (branches now point to the same commit; switching is a no-op for the working tree).
   - `git branch -D <work-branch>` (use `-D` because the reset detaches commits the branch ref previously pointed to).
   - User is back on `<starting>` with: any pre-existing uncommitted state + mutation-test strengthening + approved prunings, all unstaged. No worktree cleanup needed — there were no worktrees.
   - The user reviews the resulting `git diff` on their own and commits when ready. The skill does NOT commit or push.

## Mutant budget

The user's likely budget is **dozens, not hundreds** of mutants. Default scales with the LOC owned by the domain:

- Small domains (under ~300 LOC of source): 8–12 mutants
- Medium domains (~300–800 LOC): 10–14 mutants
- Large domains (~800+ LOC of dense logic): 14–20 mutants

**Hard cap at 20 per agent.** Past that, the marginal mutation is more likely contrived than informative. If 20 mutants leave a high-survival rate, dispatch a follow-up agent rather than letting the first one drift past the cap.

**Productive expansion is fine.** If an agent identifies more high-value mutations than its budget allows, expanding by ~50% (8 → 12, 12 → 18) keeps quality high. The cap is the brake; the budget is the suggestion. Many small sim-files have 12+ genuinely observable mutations even at 100 LOC, so the small-domain default is conservative.

Don't let domain-imbalance happen silently — if one domain wants 40 and another wants 5, that's a grouping signal: split the large domain or merge the small one before dispatch.

## Non-applicable mutations are healthy

Agents will flag some mutations as "non-applicable" — the mutation can't be observed by the assigned tests because:
- The mutated function is unexported / private to the file.
- The branch is defensive code that no current input reaches.
- The path is render-only or pure-logging (no observable simulation effect).
- The mutation is an equivalent transformation (e.g., `parsed >= 1` → `parsed > 1` when both branches return the same value at the boundary).

Non-applicable is a legitimate outcome, not a survivor. It signals test scope boundaries, not test gaps. Agents should NOT contrive new tests to cover non-applicable mutations — that's how implementation-detail pins enter the suite.

If a domain has many non-applicable mutations (e.g., 4+ in a 10-mutation budget), suspect the source file has substantial defensive or render-only code. That's a finding for the agent to report; not a problem the orchestrator needs to solve.

## Pruning low-value tests

Each mutation agent runs an embedded pruning scan as the last step of its workflow — by then, the agent's own strengthening has landed in the working tree, so the scan is post-strengthening within that domain. Cross-domain test obviation is rare given exclusive source ownership, so a separate orchestrator-side pruning pass usually isn't needed.

A test is a pruning candidate when at least one of these holds AND a sibling test in the same domain provably catches what the candidate does:

- **Subset of a stronger sibling** — every assertion is also made by another test that exercises a longer path.
- **Tautological / setup-restating** — the assertion only proves values the test just assigned.
- **Implementation-detail pin** — asserts on private collection size, helper call order, or cached internals (`array.length === 0`, `Map.size`, observer registry layout) instead of behavior.
- **Orphan path** — the branch under test is unreachable from current authored data (e.g. a dedup branch when current data has no duplicates to dedup).
- **Setup-heavy / payoff-thin** — large fixture protects a trivial outcome already covered.
- **Comment-restating without scenario** — the test narrates intent but doesn't verify behavior. (Tests MAY narrate setup; the problem is an assertion that only restates setup, not the comment itself.)
- **Symmetric-axis duplicate** — two tests pass through the same production branch and kill the same mutants (e.g. x-only and y-only variants when the production code is field-wise symmetric).

Classify each candidate:

- **Safe-delete** — a named sibling test catches the same mutants; remove the candidate, re-apply the relevant mutation, and the sibling still kills it.
- **Review** — looks low-value but proof is incomplete. Report; do not propose deletion.
- **Keep** — the only guard for a user-visible behavior, boundary, regression, or reachable code path.

**Don't:**
- Prune to fit a budget. Zero candidates is a fine result; 5 contrived ones is not.
- Prune tests added or strengthened in THIS run. Strengthenings need at least one downstream review before they become pruning candidates.
- Prune a test because it "feels redundant." Point at the specific sibling and the specific mutants both would catch.
- Prune scenario-narration tests in user-flow files just because they share setup with siblings. Symmetric-axis duplicates ARE candidates; named distinct user actions are NOT.
- Prune around boundary tests. Off-by-one / empty-input / single-element cases are rarely subsumed by general-case tests.

**If pruning empties a test file**, delete the file too. An empty test file (or one reduced to a single trivial smoke-check) is itself a pruning candidate — surface it during the user walk-through and remove it on approval.

**Approval cadence when walking candidates with the user.** Batch all **Safe-delete** candidates into one user-confirmation (they're explicitly proven safe — sibling test catches the same mutants). Walk **Review** candidates **one-by-one** — each is a judgment call by definition; the user weighs each. Don't intermix the two tiers in a single batch.

## Agent prompt template

Send this to each subagent. Replace `<test files>` with the assigned test file path(s), `<source files>` with the exclusive source files, and `<other agents>` with the count of other agents that will run before or after this one. **If the project has `dev/coding/testing.md`, append its contents to the Project conventions section at the bottom of this template before sending.**

```
You are doing **mutation testing** on the <domain name> code.

## Goal

Verify that <test files> actually catch small logic errors in the production code. For each mutant the tests miss (a "survivor"), either strengthen the test or fix the code if a real bug surfaced.

## Scope (exclusive ownership)

- **Test file(s):** <test files>
- **Source file(s) you may mutate:** <source files>

Do NOT mutate any other file. The orchestrator runs one agent at a time across multiple domains; staying inside your assigned source files keeps attribution clean and ensures the per-agent integration commit only carries your changes.

## Workflow per mutant

1. **Read each source file end to end** before picking mutants. Read the test file(s) too — focus on logic those tests actually observe.
2. For each candidate mutation:
   a. Apply with Edit (one mutation at a time).
   b. Run the relevant test file (project-specific command, e.g. `npx tsx <test file>`, `cargo test <name>`, `pytest <test file>`). Killed = non-zero exit. Survived = zero exit.
   c. **Revert and verify the chained check.** Edit back, then BOTH (i) `git diff <source file>` returns empty AND (ii) re-run the test, exit 0. If either fails, STOP — do `git checkout -- <source file>`, re-run the test until both checks pass before continuing. A drifted file silently turns the next "killed" into a phantom kill (or "survived" into a phantom survivor); skipping the chain compounds invalid results.
   d. Do not move to the next mutation until both checks pass.

## Mutation strategy

Generate **8–12 candidates** focused on observable logic. Pick from:

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
- **Paired-branch coverage**: when source code uses a paired condition (`x > y`, OR `||`, x/y axis), check that the test catches the symmetric case too. Asymmetric branch coverage is the most common test gap.
- **Range-boundary tests**: when the source compares against a cutoff or capacity, place an event AT the boundary. Well-inside or well-outside values won't catch a `<` ↔ `<=` flip.
- **`Math.max(0, ...)` clamps**: swap for bare `x` — common survivor when tests cover only the happy non-negative path.
- **Set/Map.add side-effect skip**: drop a `takenIds.add(...)` or `cache.set(...)` — survivor when tests don't assert uniqueness across many generated items.
- **Regex flag changes**: drop `g`/`i` from a `/pattern/g`. Tests with single-occurrence inputs miss this.
- **`await` removal**: drop `await` on a single call — survives whenever the test doesn't observe the awaited result.
- **Other operator swaps**: `??` and `||` fallback swaps, optional-chain removal (`?.` → `.`), sort comparator flips (`a - b` → `b - a`), nullish-coalesce argument-order swaps (`a ?? b` → `b ?? a`), object-key swaps in same-typed positions.
- **Public-API entry points over internal helpers**: when the source exposes both a class/factory AND internal helpers used inside it, prefer mutating logic reachable through the public API. Mutations to internal helpers may be non-applicable if the assigned tests only call the public API.

Skip mutations whose effect can't be detected by the assigned tests (pure logging, render-only paths, dead branches, defensive guards no input reaches). Note them as "non-applicable" rather than counting as survivors.

## Handling survivors

For each survived mutant, decide between strengthening the test and fixing the code using this test:

- **Strengthen the test if:** the original code was correct and the mutation is a contrived alternative behavior the test happens not to observe (boundary the tests didn't exercise; `Math.max` ↔ `Math.min` swap on always-in-range data; defensive code path tests can't reach).
- **Fix the code if:** the mutation produces behavior the surrounding code relies on (a missing `Math.max(0, x)` clamp lets a counter go negative, breaking a downstream availability calc; a missing `takenIds.add(id)` lets two records share an id, breaking a registry lookup).
- **The decision rule:** ask "does any other code in the system already trust the un-mutated behavior to hold?" If yes → real bug, fix the code. If no → test gap, strengthen the test.

**Don't** add an assertion that pins internal storage shape — array lengths on private observer registries, cache `.size`, the order of the current random shuffle. Those break under behavior-preserving refactors. Test the public contract (call the API, observe the result) instead. When unsure, lean toward strengthening; bug fixes carry more risk than test additions.

**Comment style for strengthened tests.** When you add an assertion or test to kill a survivor, write a one-sentence comment naming the specific mutation it pins. Format: `// Pin <X>. <Mutation> would <observable failure>.` Six months later, no one will remember why a magic value was the right test number — the comment makes it self-documenting.

**New test files are OK when a survivor doesn't fit any existing one.** Most strengthenings fit an existing test file in the assigned scope; create a new file in the same test directory when the survivor exercises a distinct module or domain shape that doesn't match. Splitting a long existing test file for tidiness is a structural call — propose it in the report (the orchestrator surfaces it for user approval) rather than executing it autonomously.

## Pruning scan

After resolving survivors, scan the assigned test files for prunable tests using the categories and safety classification in `SKILL.md § Pruning low-value tests`. Cap at ~5 candidates per agent — pruning is a side-channel, not the primary output. Report under a "Pruning candidates" heading separate from survivors. Do NOT delete tests — propose only.

## Final state

The working tree's `git diff` must contain ONLY:
- Strengthened test code
- Real bug fixes (only if you found any)

NO stray mutations. Verify with `git diff <source files>` returning empty (or showing only intentional bug fixes). Then run the project's full test command to confirm the full suite still passes. The orchestrator will commit your changes before launching the next agent — leaving stray mutations would poison the next agent's baseline.

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
...

## Survivors and resolutions

### Survivor 1: <one-line summary>
- **Location:** `src/foo.ts:142`
- **Mutation:** `< amount` → `<= amount`
- **How to reproduce:** apply mutation, then `<test command>` exits 0
- **Resolution:** strengthened `tests/foo.test.ts:88` (added boundary case)
- **Confidence:** high / medium / low (gap is real / could be borderline non-applicable / unsure)

## Final test run
<test command>: X passed, 0 failed

## Files changed
- tests/...
- src/...ts (bug fixes only, if any)

## Summary footer (orchestrator-greppable)
SUMMARY: <mutations> tried, <killed> killed, <survived> survived, <test-strengthenings> tests strengthened, <bug-fixes> source fixes.
```

If you have **zero survivors**, report it honestly. Don't manufacture findings.

## Project conventions

<The orchestrator inserts the "Project conventions to add to each agent prompt" section from `dev/coding/testing.md` (project root) here, if it exists. Otherwise this section is empty and the agent relies on the user-global coding rules already loaded via CLAUDE.md.>

## Per-domain gotchas

<The orchestrator inserts the matching bullet from `dev/coding/testing.md` § "Per-domain gotchas" here based on the assigned domain. If the project has no `dev/coding/testing.md`, or no bullet matches the domain, this section is empty.>
```

## Why exclusive source-file ownership

Sequential dispatch (step 3) means only one agent is writing to the filesystem at a time, so there is no race condition. But exclusive source-file ownership still matters: it ensures clean attribution (each strengthening commit names which agent/domain produced it) and balanced workloads (each domain owns a coherent slice of source LOC). Without exclusive ownership, two agents would pick overlapping mutations and waste budget on the same surface.

When tests share a source file, fold them into one domain rather than splitting. A larger domain takes longer but stays correct.

## Why a work branch

Integration creates a window of uncommitted local state — between when an agent's changes land in the working tree and when they are committed. Anything that touches the working tree during that window can erase the work silently: a working-tree-level `git checkout`, an external sync tool, a pause-and-resume mechanism that snapshots state, a manual revert. Working-tree reverts don't update reflog, so a loss in this window leaves no trace.

The work branch (step 0.5) closes the window. Each integration commits immediately to the work branch — no waiting for user approval to commit, since the work branch is throwaway and never reaches the starting branch as commits. The starting branch is untouched throughout the skill. If anything goes wrong mid-skill, the work branch holds the only canonical copy on disk; the user can inspect, recover, or discard.

The work branch also preserves pre-existing uncommitted state. If the user had a refactor in progress when they invoked the skill, step 0.5 commits it as a WIP commit so the agents see it (otherwise the agents would work against stale-on-disk code that doesn't match local state). Step 8 unwinds the WIP commit and all strengthening commits on hand-back, returning the user to their starting branch with: any pre-existing uncommitted state + strengthening + approved prunings, all unstaged. The user commits when they're ready — the skill never lands commits on the starting branch.

The flow is also resumable: an aborted skill leaves the work branch behind. A re-run detects it (step 0.5) and surfaces the choice to delete or resume.

## Why sequential, not parallel

The Agent tool's `isolation: "worktree"` parameter would allow parallel agents — but it has two failure modes in practice:

1. **Worktree-base divergence.** The worktree harness sometimes branches new worktrees from `origin/main` (or another remote anchor) rather than the local work branch. When the user has an in-progress refactor that renamed/moved files, agents see the OLD paths in their worktree and write tests that won't apply cleanly to the work branch. Symptoms: agents reporting "file is `src/X.foo.ts` in this worktree, not `src/foo-X.ts`"; tests using helpers under old names; `git apply` rejecting patches at integration time.

2. **Isolation bypass.** Agents sometimes resolve absolute file paths to the originating repo and write there directly, bypassing their worktree. The worktree's diff is empty (so the harness auto-cleans it on completion), and the agent's changes leak to the parent repo's working tree. Symptoms: worktree directories vanish despite the agent reporting changes; main repo `git status` shows test-file modifications the orchestrator didn't expect.

3. **User policy.** Many users (including the default CLAUDE.md template) ban `git worktree` use without explicit permission.

Sequential dispatch in the main checkout sidesteps all three. Wall time is ~N× longer for N domains, but each agent sees the actual local state and writes through the normal filesystem boundary.

If the user explicitly opts into parallel-worktree mode (e.g. "use worktrees, I'm fine with the trade-off"), fall back to the parallel path: dispatch all agents in parallel with `isolation: "worktree"` at step 3, then in step 4 generate per-worktree patches (`git -C <worktree> diff HEAD > /tmp/agent-<id>.patch`) and apply with `git apply --3way`. After step 8 lands, remove each worktree with `git worktree remove --force --force .claude/worktrees/agent-<id>` — double `--force` is required because the harness locks worktrees with `git worktree lock`. Be ready to manually port test additions when the worktree-base divergence hits (agents may see a stale anchor instead of the local work branch HEAD).

## Per-domain gotchas (orchestrator instructions)

If the project has `dev/coding/testing.md` with a "Per-domain gotchas" section, the orchestrator matches each domain to a bullet at dispatch time and splices the matching bullet into the agent prompt's `<Per-domain gotchas>` placeholder. Each bullet typically names which clusters are dense, where survivors concentrate, which file types stub the DOM, etc. Domains that don't match any bullet leave the placeholder empty.
