---
name: iterate-skill
description: "[rp] Empirically test-and-fix another skill — run it on sample inputs in your session, evaluate each run for defects (stalls, lost state, bad resume, contract violations), fix its SKILL.md, and loop until it converges. User-initiated only; do not trigger on mentions of iterate-skill."
allowed-tools: Task, Read, Write, Edit, Bash(bash .claude/skills/iterate-skill/scripts/start-zellij-iterate.sh *), Bash(bash .claude/skills/iterate-skill/scripts/work-folder-name.sh *), Bash(mkdir:*), Bash(cp:*), Bash(rm:*), Bash(ls:*), Bash(git:*), Bash(diff:*), Bash(printf:*), Bash(cat:*), Bash(grep:*), Bash(wc:*)
---

# Iterate Skill

## Goal

- Empirically test-and-fix a target skill's `SKILL.md`: run it on sample inputs, judge each run for defects, fix the offending instruction in `SKILL.md`, loop until clean.

## Activation

- User-initiated only: `/iterate-skill` or a direct request naming a target. A passing mention is not an invocation.
- `$ARGUMENTS` names the target — a skill name or a path to a skill folder. It resolves the work-folder name (below).
- If `$ARGUMENTS` is empty, list any existing `iterate-skill-*.local/` folders at the repo root and ask the user — resume which one, or start fresh on a new target. Never silently pick a folder, even when only one exists.

## Run mode

- Run the target in your normal interactive session — not a `claude -p` subprocess, not a subagent (the target dispatches its own subagents, which a subagent cannot do).
- Run a scenario by **following the candidate `SKILL.md` copy as a file** — not by `/`-invoking the installed skill. Mechanism: `references/spec.md`.
- Never touch the live skill in `.claude/skills/` until promotion is approved.
- Not unattended — you drive the loop across `/clear`s.

## Zellij driver (opt-in)

- The user must start Claude inside zellij before invoking iterate-skill, usually from the target repo:
  ```
  bash .claude/skills/iterate-skill/scripts/start-zellij-iterate.sh
  ```
- Do not move an already-running non-zellij conversation into zellij. The opt-in is fixed at run start; mid-run a non-zellij run cannot become zellij-driven.
- The `/clear`-and-resume rhythm below branches on whether the orchestrator's environment exposes a zellij pane id (`$ZELLIJ_PANE_ID`) — that is the only signal Claude has. A user running Claude inside their own zellij session also takes the zellij branch; the helper's keystroke targeting is correct either way.

## Work folder

- Path: resolve via `bash .claude/skills/iterate-skill/scripts/work-folder-name.sh <target>` — that returns the canonical folder name, deterministic against model drift. Do not compute the name by string interpolation. The literal pattern is `iterate-skill-<target>.local/` at the repo root with no dedup of an `iterate-skill-` prefix on the target — for target `iterate-skill-mock` the folder is `iterate-skill-iterate-skill-mock.local/`, not the deduplicated `iterate-skill-mock.local/` (which would visually collide with the target's own work folder inside `workspace/`). The `.local` suffix keeps it gitignored under the repo's `*.local/` pattern — check once on fresh-run setup; add the line only if absent. If the repo isn't a git repo, skip the check (no `.gitignore` to read or write).
- Layout:
  - `progress.md` — iterate-skill's ledger and resume anchor (format below).
  - `test-spec.md` — frozen test spec: Inputs manifest, Scenarios, Checks (`references/spec.md`). Written only at the end of Phase 1; before that, the draft lives in `phase1/draft-test-spec.md`.
  - `phase1/` — Phase 1 working outputs, written as each sub-step completes so resume can skip ahead. `phase1/inputs-manifest.md` (Part 1, orchestrator-written: candidate/fixture/held-out paths plus run environment per `references/spec.md`), `phase1/contract-extracted.md` (the `contract-extractor`'s returned Part 3), `phase1/scenarios.md` (the `scenario-mapper`'s returned Part 2), `phase1/draft-test-spec.md` (the assembled draft before user approval). All four exist by the time `test-spec.md` is frozen.
  - `candidate/` — full copy of the target skill folder; the artifact under test and the file set the fixer edits.
  - `fixture/` — faithful git repo the loop runs against; pristine after spec freeze.
  - `held-out/` — smaller held-out repo; the loop never runs against it.
  - `workspace/` — current run's working copy of a fixture. Reset before every fresh scenario run; **not** reset when resuming the second half of a mid-scenario `/clear` (the partial state is what the resume scenario tests).
  - `regression-suite.md` — every defect found this run, each a replayable case (`references/convergence.md`).
  - `transcripts/` — one transcript per run, `transcripts/<run-id>.md` where `<run-id>` is defined under the ledger format. The orchestrator writes the transcript itself, immediately after each scenario run finishes (mechanism in `references/spec.md`).
  - `iterations/` — one record per iteration, `iterations/iter-<NN>.md`: judge verdicts, then the fixer-pass entry. `<NN>` is zero-padded 2 digits up to 99; beyond that, the natural width (`iter-100`, `iter-101`).
  - `next-prompt.txt` — one-line resume prompt for the next `/clear`. Starts with the literal sentinel prefix `[iterate-skill-resume]` so a paste is unambiguous (defined in the `/clear`-and-resume rhythm section below).
  - `report.md` — running user-facing report; final deliverable alongside the converged candidate.

### Ledger format — `progress.md`

Header block plus four append-only logs:

```
# iterate-skill progress — <target-skill-name>

Target: <path to the live target skill>
Environment: model <id>, CLI <version>, <relevant settings>
Candidate size at start: <N> lines.  Size gate: <gate> lines.
Knobs: M=<M>, N=<N>, iteration-cap=<cap>, runs-per-clear=<count | "tbd">, effort-on-clear=<max | preserve | "tbd">.
Started: <date>.

Phase: <1-spec-generation | 2-loop | 3-termination>
Phase-1 substate: wave1=<pending | done>; wave2=<pending | done>; draft=<pending | shown | approved>; spec=<pending | frozen>
Phase-2 substate: pacing-asked=<no | yes>; current-iteration=<iter-NN>; current-run=<run-id | none>
Phase-3 substate: outcome=<pending | converged | cap-hit | stuck>; held-out=<pending | passed | failed>; taste-pass=<pending | done>

## Run log
- run <run-id>: <scenario-id> — <P>/<T> gated pass; contract <defect-id,… | none>; env <count>
- fixer-pass iter-<NN>: applied <count> | flagged <count> | no-defects

## Defect ledger
- <defect-id>: <open | fixed@iter-NN | flagged@iter-NN | stuck>; seen iter <N,…>

## Iteration markers
- iter-<NN>: <started | fixer-applied <count> | fixer-flagged <count> | no-defects | converged | cap-hit | stuck>

## Surfaced
- iter-<NN>: <environment failure | size-gate flag | stuck pause | target-mismatch | spec-drift> — <one line>
```

**Format definitions:**

- `<run-id>` = `i<NN>-<scenario-id>-<seq>`, where `<NN>` is the iteration number using the same padding rule as `iter-<NN>` (zero-padded to 2 digits up to `i99`, natural width for `i100` and above), `<scenario-id>` is the Part 2 scenario id, and `<seq>` is a per-iteration per-scenario counter starting at `1`. Example: `i03-resume-mid-apply-2` is the 2nd run of scenario `resume-mid-apply` in iteration 3 (correlates to `iter-03`).
- `<NN>` = the iteration number, zero-padded to 2 digits up to `iter-99`; for `iter-100` and above, use the natural width (no truncation, no overflow).
- `<P>` = gated checks this run passed (out of those the scenario exercises). `<T>` = gated checks the scenario exercises in total. Always counted against the same denominator: only the scenario's `Exercises checks` list from `test-spec.md` Part 2.
- `<defect-id>` format is defined in `references/convergence.md` (now five fields including the branch axis).
- `fixer-pass iter-<NN>: no-defects` records an iteration that produced zero `contract` defects (no fixer was dispatched; the M-window does NOT reset — see `references/convergence.md`).

**Append-only with last-line-wins.** Every log is append-only — no line is ever rewritten in place. When an id (`<run-id>`, `<defect-id>`, `iter-<NN>`) transitions state, append a NEW line with the new state. Resume readers and stuck-detection take the **last** matching line per id as the current state.

**The `Phase:` and sub-state lines are rewritten in place.** Those four lines are the resume anchor — there is one current `Phase:`/sub-state at any time, not a history. Sub-state transitions are pinned to the steps below (Phase 1 sub-steps, the Phase 1→2 transition, the Phase 2→3 transition); rewrite them as named atomic actions, not as a side-effect of doing the next thing.

**Only the substate line matching the current `Phase:` is authoritative.** Prior phases' substate lines remain in the file (they're never deleted on transition) but become stale once `Phase:` advances. Resume readers must read `Phase:` first and consult only the matching `Phase-<n> substate` line — never trust `current-iteration` from `Phase-2 substate` when `Phase: 3-termination`.

- Resume reads `Phase:` + sub-state for current position, then the four logs to reconstruct run history, open defects, and iteration count.
- Nothing needed to resume lives only in context.

## Run start — fresh or resume

Before any work, check for `iterate-skill-<target-skill-name>.local/`.

- **Empty or absent** → fresh run. Create the work-folder subtree (including `phase1/`), copy the target skill folder to `candidate/`, write the initial `progress.md` (header block; `Phase: 1-spec-generation`; all Phase-1 substate `pending`; `runs-per-clear=tbd` until Phase 2 asks the user), proceed to Phase 1.
- **Non-empty, `progress.md` missing or unreadable** → stop and ask whether to reset; never guess at state.
- **Non-empty, `progress.md` valid** → read it. **Reconcile the target.** Compare the `Target:` line against `$ARGUMENTS`: if they name different skills, stop and surface the mismatch to the user as `target-mismatch` — the user decides reset, rename the folder, or correct the invocation. **Only on a match** report the target, phase, sub-state, iteration count, open defects, and continue from the recorded position. If the invocation was a manual `/iterate-skill <target>` rather than a `next-prompt.txt` resume, ask **resume** or **reset** first. A message whose first non-blank line begins with the literal prefix `[iterate-skill-resume]` is a `next-prompt.txt` resume — skip the question. (A user-typed message that lacks the sentinel is treated as a manual invocation, even if its body paraphrases the resume template.)
- On resume, everything needed is on disk: `candidate/`, `fixture/`, `held-out/`, `test-spec.md` (once Phase 1 froze it; otherwise the partial Phase 1 outputs under `phase1/`), `regression-suite.md`, `iterations/`, `transcripts/`, `progress.md`.

## Phases

### Phase 1 — Spec generation

Phase 1 progresses through four named sub-steps. After each, update the relevant `Phase-1 substate` marker in `progress.md` and write the named output to disk so resume can skip ahead. Full detail: `references/spec.md`.

Before each sub-step, announce position to the user in one line so they can see where the run is:

- step 1 → "Phase 1, Wave 1 of 2 — dispatching contract-extractor and fixture-assembler in parallel."
- step 2 → "Phase 1, Wave 2 of 2 — dispatching scenario-mapper."
- step 3 → "Phase 1, sub-step 3 of 4 — draft test spec assembled; approval checkpoint below."
- step 4 → "Phase 1 done — spec frozen, entering Phase 2."

1. **`wave1=done`.** Dispatch Wave 1 in parallel: `contract-extractor` and `fixture-assembler`. Both read only `candidate/`; their writes are bounded — `contract-extractor` returns text only, and `fixture-assembler` writes only `fixture/` and `held-out/`. Wait for both. Write the `contract-extractor`'s returned Part 3 to `phase1/contract-extracted.md`. Verify `fixture/` and `held-out/` exist on disk. Then set `wave1=done`.
2. **`wave2=done`.** Dispatch Wave 2: `scenario-mapper` — reads `candidate/`, the now-built `fixture/` and `held-out/`, and the gated-check list from `phase1/contract-extracted.md`; every scenario names real fixture files and declares which gated checks it exercises. Write its returned Part 2 to `phase1/scenarios.md`. Then set `wave2=done`.
3. **`draft=shown` → `draft=approved`.** First write Part 1 (the Inputs manifest naming `candidate/`, `fixture/`, `held-out/`, and run environment per `references/spec.md`) to `phase1/inputs-manifest.md`. Then assemble Parts 1, 2, 3 (`phase1/inputs-manifest.md`, `phase1/scenarios.md`, `phase1/contract-extracted.md`) into `phase1/draft-test-spec.md`. Show it to the user — the one approval checkpoint before the loop. Set `draft=shown`. Apply adjustments in one revision pass (re-dispatching the relevant Wave agent as `references/spec.md` describes for Parts 2 and 3; for Part 1, regenerate `phase1/inputs-manifest.md` directly). Each updated output replaces the earlier `phase1/*.md` file. On final user approval, set `draft=approved`.
4. **`spec=frozen` → Phase 1→2 transition.** Copy `phase1/draft-test-spec.md` to `test-spec.md`. Set `spec=frozen`. As one atomic update — same `Write` of `progress.md` — rewrite `Phase: 2-loop` and set `Phase-2 substate: pacing-asked=no; current-iteration=iter-01; current-run=none`. The loop opens on `iter-01`, so step 1's `<run-id>` derivation (`i<NN>-…`) has a valid `<NN>` from the first run; step 6 only ever increments from there. This is the named Phase 1→2 boundary; no other step rewrites `Phase:` to 2.

On resume during Phase 1, read the substate markers and skip to the first sub-step whose marker is `pending`. Before re-doing that sub-step, wipe its expected outputs (Wave 1: `phase1/contract-extracted.md`, `fixture/`, `held-out/`; Wave 2: `phase1/scenarios.md`; draft: `phase1/inputs-manifest.md` and `phase1/draft-test-spec.md`; spec: `test-spec.md`) so the re-do starts on a clean slate rather than inheriting partial state from an interrupted prior attempt. Then run the sub-step — for Wave 1 and Wave 2, re-dispatch the relevant agent per `references/spec.md`'s "re-dispatch supplies the full original prompt" rule.

### Phase 2 — Iteration loop

If `Phase-2 substate: pacing-asked=no`, ask the user two settings — once per run, recorded in `progress.md`. Send both questions in one message labeled with their position so the user sees how many remain:

- **Question 1 of 2 — Pacing.** State the model's context-window size and the frozen scenario count `S` from `test-spec.md`. Present 3–4 concrete preset options in plain text — each preset bundles a per-scenario run count `M` (how many times each scenario runs in the convergence window, per `references/convergence.md`) with a runs-per-`/clear` chunk size. For every preset, **compute and show the resulting `/clear` count per iteration** as `ceil(S * M / runs-per-clear)` so the user can pick by length. Suggested presets:

  - **Fast** — `M=2`, `runs-per-clear=3`. Quick smoke test of iterate-skill itself; lower confidence on intermittent defects.
  - **Default (recommended)** — `M=5`, `runs-per-clear=3`. Balanced detection of intermittent defects.
  - **High fidelity** — `M=5`, `runs-per-clear=1`. One scenario per chunk keeps context coldest; cheap when zellij automates `/clear`.
  - **Thorough** — `M=10`, `runs-per-clear=5`. Catches rarer intermittent defects.

  The user can pick a preset or specify custom `M` and `runs-per-clear`. `N=M` is the zero-tolerance default (per `references/convergence.md`); only lower `N` if the user explicitly asks.
- **Question 2 of 2 — Effort behavior at each `/clear` (zellij auto-clear flow only).** Default `max`: queue `/effort max` after every `/clear` (the legacy hardcoded behavior; useful for users on effort max who want it re-asserted as a safety net). Alternative `preserve`: skip the `/effort` step at each `/clear` so the user's chosen effort persists across clears (the right choice for non-max-effort runs like sonnet medium that would otherwise get bumped to max at every clear). No effect outside zellij — pick `preserve` if unsure or not using zellij.
- Record the picks on the `Knobs:` line: `M=<n>, N=<n>, runs-per-clear=<n>, effort-on-clear=<max | preserve>`. Then set `pacing-asked=yes`.
- `zellij-clear-resume.sh` reads `effort-on-clear` from `progress.md` directly per `/clear` — the decision is deterministic against LLM drift, not re-evaluated by the orchestrator each chunk.
- Resume reads `M`, `N`, `runs-per-clear`, `effort-on-clear`, and `pacing-asked` from `progress.md` — never re-ask.

**Resume scenarios always cut at one `/clear` regardless of pacing.** A resume scenario tests whether the target survives a `/clear` mid-run, so the cut is integral to the scenario — even when `runs-per-clear>1`, the chunk ends at the cut. The minimum cut count per resume scenario is one, never zero.

Then the loop runs — one `/clear`-bounded chunk at a time. Each chunk advances the iteration recorded in `Phase-2 substate: current-iteration`:

1. **Decide fresh vs. continuation, then prepare `workspace/`.** Read `current-run` from Phase-2 substate.
   - `current-run=none` → fresh chunk. Pick the next scheduled scenario, derive its `<run-id>` (to get `<seq>`, count distinct run-ids in the Run log matching `i<NN>-<scenario-id>-*` for the current iteration, then add 1), reset `workspace/` (`rm -rf workspace && cp -R fixture workspace`, or from `held-out/` for the held-out pass), and as one atomic `Write` of `progress.md` set `current-run=<run-id>` and append `run <run-id>: started` to the Run log.
   - `current-run=<run-id>` → a scenario is mid-flight from a prior chunk. Inspect `transcripts/<run-id>.md`:
     - Footer `Terminal: cleared-at-<cut>` → this chunk continues the scenario from the cut. **Do NOT reset `workspace/`** (resetting would destroy the partial state the resume scenario tests). Proceed to step 2 to resume the scenario.
     - Footer `Terminal: reached` → the scenario completed. If `iterations/iter-<NN>.md` (current iteration) has no verdict block for this `<run-id>`, skip steps 2 and 3 and dispatch the judge (step 4). If a verdict block already exists, the judge already ran — source the run's P/T counts, contract defect-ids, env count, and non-gating observations from that on-disk verdict block (there is no live judge return on this path), then complete any remaining writes from `references/evaluate-and-fix.md`'s "after each judged run" checklist that have not landed: do not re-append the verdict block (its presence is the detection signal); add-or-update the defect ledger and `regression-suite.md` (both keyed by defect-id, so a second write is a no-op when the entry is already present); append a `report.md` section for this `<run-id>` only if its `### Run <run-id>` header isn't already present. Then, as one atomic `Write` of `progress.md`: if the Run log has no final line for `<run-id>` beyond `started`, append it using the sourced values; reset `current-run=none`.
     - Transcript missing → the orchestrator was interrupted between marking `current-run` and writing the transcript. Reset `workspace/` and re-run from step 2 against the same `<run-id>`.
2. **Run a scenario** by following `candidate/SKILL.md` as a file (mechanism: `references/spec.md`).
3. **Capture the transcript.** When the scenario reaches its terminal state (or the helper queues a mid-run `/clear`), write `transcripts/<run-id>.md` as a single `Write` call. The orchestrator IS the transcript producer, so "capture" means writing a structured record of THIS session's actions while following the candidate: one line per orchestrator step (tool / outcome / target progress-file delta), each prompt the target asked and the scripted answer given, the target skill's progress-file paths under `workspace/.<target-skill-name>.local/` as they existed at scenario end, then a `Terminal: <reached | cleared-at-<cut-point>>` footer. The judge reads this file plus the on-disk progress files; nothing else exists.
4. **Dispatch the `judge`** for that run; the judge evaluates and classifies. Append the per-run updates to `progress.md` and the other artifacts per the "after each judged run" checklist in `references/evaluate-and-fix.md`. Then, as one atomic `Write` of `progress.md`, append the final `run <run-id>: <P>/<T> gated pass; contract <defect-id,… | none>; env <count>` line to the Run log (last-line-wins overrides the earlier `started` entry) and reset `current-run=none` in Phase-2 substate.
5. **End of iteration — dispatch the `fixer` or record `no-defects`.** When the iteration's runs are done (every scenario hit M runs since the last candidate-changing fixer pass per `references/convergence.md`), do exactly one of:
   - **Contract defects > 0** → snapshot `candidate/` to `iterations/iter-<NN>-pre-fixer/` (`cp -R candidate iterations/iter-<NN>-pre-fixer`) and copy `iterations/iter-<NN>.md` to `iterations/iter-<NN>-pre-fixer.md`. Verify the snapshot before dispatching the fixer: `wc -l iterations/iter-<NN>-pre-fixer.md` must match `wc -l iterations/iter-<NN>.md`, and `find iterations/iter-<NN>-pre-fixer -type f | wc -l` must match `find candidate -type f | wc -l`. If either mismatches, the `cp -R` was interrupted — surface to the user and do not dispatch the fixer; the snapshot is the only path back if the fixer is then interrupted mid-edit. Once verified, append `fixer-pass iter-<NN>: dispatched` to the Run log. Dispatch the `fixer` over the iteration's deduplicated `contract` defects (per `references/evaluate-and-fix.md`). On the fixer's return, append `fixer-pass iter-<NN>: applied <count> | flagged <count>` to the Run log (last-line-wins overrides the `dispatched` entry) and `iter-<NN>: fixer-applied <count>` (or `fixer-flagged <count>` if every defect was size-gated) to the Iteration markers. On resume: if the latest `fixer-pass iter-<NN>` Run-log entry is `dispatched` with no following completion, the fixer was interrupted mid-edit. If `iterations/iter-<NN>-pre-fixer/` or `iterations/iter-<NN>-pre-fixer.md` is missing, surface to the user and stop. Otherwise restore `candidate/` from the snapshot (`rm -rf candidate && cp -R iterations/iter-<NN>-pre-fixer candidate`) and restore `iterations/iter-<NN>.md` from `iterations/iter-<NN>-pre-fixer.md` (`cp iterations/iter-<NN>-pre-fixer.md iterations/iter-<NN>.md`) to clear the orphaned planned-fixes block, then re-dispatch.
   - **Contract defects = 0** → do NOT dispatch the fixer. Append `fixer-pass iter-<NN>: no-defects` to the Run log and `iter-<NN>: no-defects` to the Iteration markers. The M-window does NOT reset — the loop keeps accumulating clean runs against the same candidate, and convergence can land on a `no-defects` iteration without an additional fixer pass (see `references/convergence.md`).
6. **Increment iteration, or transition to Phase 3.** Per `references/convergence.md`, decide one of: continue (update `current-iteration` to `iter-<NN+1>`); converged; cap-hit; stuck. On any termination, as one atomic `Write` of `progress.md`, rewrite `Phase: 3-termination` and set `Phase-3 substate: outcome=<converged | cap-hit | stuck>; held-out=pending; taste-pass=pending`. This is the named Phase 2→3 boundary; no other step rewrites `Phase:` to 3.

- Judge, classifier, fixer: `references/evaluate-and-fix.md`.
- Defect identity, regression suite, convergence, termination conditions: `references/convergence.md`.

### Phase 3 — Termination and report

The Phase 2→3 transition step (above) recorded one of `outcome=converged | cap-hit | stuck`.

Announce the outcome and steps ahead, in one line up front, and at each transition inside Phase 3:

- on entry → "Phase 3 — outcome <converged | cap-hit | stuck>."
- entering held-out (converged path only) → "Phase 3, step 1 of 2 — held-out pass."
- entering taste pass (converged path only) → "Phase 3, step 2 of 2 — final taste pass."
- before finalize → "Phase 3 done — `report.md` finalized, awaiting your promotion decision."

- **`outcome=converged`** → run the held-out set once. Set `held-out=passed` or `held-out=failed` per the outcome (`references/convergence.md`). Whichever, run the final taste pass on the converged candidate; set `taste-pass=done` (`references/evaluate-and-fix.md`). A held-out failure is the verdict — it does NOT reopen the loop, and the candidate is not promoted.
- **`outcome=cap-hit` or `outcome=stuck`** → skip the held-out and taste passes; `held-out` and `taste-pass` stay `pending`. Report the open defects.
- Finalize `report.md`.

### Install — user step, never automatic

- iterate-skill does not install. Present the converged `candidate/` (its diff from the original) and `report.md`.
- On the user's **explicit** approval, **replace** the live skill — never overlay. `rm -rf .claude/skills/<target-skill-name>/ && cp -R candidate/ .claude/skills/<target-skill-name>/`. Overlaying would leave stale files the candidate dropped during iteration (e.g. a reference file the fixer removed), and the live skill would carry both the new SKILL.md and the orphan reference.
- Editing `.claude/skills/` is the user's call alone — never promote without explicit sign-off.

## `/clear`-and-resume rhythm

A full target-skill run will not fit one context window — work in `/clear`-bounded chunks sized by the `runs-per-clear` knob set at Phase 2 start. At each checkpoint:

1. Write all state to the work folder so the `/clear` is safe. Reconcile `progress.md` with the current run: if the environment or plan changed mid-run, rewrite the header line and any run-specific section that named the old state — no part of `progress.md` may contradict another.
2. **Output a chunk summary and position to stdout** before writing `next-prompt.txt` — two terminal-visible lines giving the user a status read at each `/clear` boundary, composed from this chunk's run-log entries and the iteration counter:

   ```
   Chunk summary: <X> runs done (<run-id>, <run-id>, ...); <Y> new contract defects (<defect-id>, ...); <Z> env failures (<sub-reasons>); surfaces: <list or "none">.
   Position: iter-<NN> of <cap> (cap from the Knobs line).
   ```

   Without these the user has to grep `progress.md` to know what happened in the chunk and how far the run is from the iteration cap. Append any condition surfaced under `Mid-iteration surfacing` (`references/convergence.md`) — high env-failure rate, persistent env failures, size-gate flags — to the `surfaces:` list so the user reads it at the `/clear`, not buried in `progress.md`.
3. Write the next resume prompt to `next-prompt.txt` as **one line** — it points only at on-disk state, never at context a `/clear` will empty. The line begins with the literal prefix `[iterate-skill-resume]` (the sentinel the run-start branch matches to recognize a `next-prompt.txt` resume). The zellij helper rejects embedded LF or CRLF — embedded newlines would submit mid-prompt as separate turns — so the prefix-plus-body must be one line.

   The `PostToolUse` hook configured in `.claude/settings.local.json` fires automatically after this `Write` — `auto-clear-hook.sh` calls `zellij-clear-resume.sh`, which backgrounds `/clear` + paste keystrokes ~15 seconds later. The orchestrator does not call the helper itself; writing the file IS the trigger.

   End the turn with a one-line note: "Auto-clear queued; if no `/clear` lands within ~25 seconds the hook is likely not installed on this machine — `/clear` manually and paste `<work-folder>/next-prompt.txt` from disk." Stop the turn.

`next-prompt.txt` holds the literal sentinel prefix plus the resume request, naming the target and the position — for example (all on one line):

```
[iterate-skill-resume] Resume iterate-skill for target <target-skill-name>. Work folder iterate-skill-<target-skill-name>.local/ — read progress.md and continue from the recorded position.
```

- The sentinel prefix is what the run-start branch matches as "explicit choice to resume — skip the resume-vs-reset question". A user message that paraphrases the body without the prefix is treated as a manual invocation and gets the confirmation question.

## Context discipline

Hard requirement. Quality drops as a context window fills — `/clear` early, with healthy headroom; never run context near full. The mechanism is structural, not a context-meter reading:

- **Chunk size — set at Phase 2 start, never assumed.** Default is one scenario run per `/clear` (≈200K of context, highest fidelity). With user opt-in, several runs can batch per chunk, trading some fidelity for fewer `/clear`s. The chunk also bounds at one judge-and-fix step. Honor the `runs-per-clear` knob in `progress.md`; never batch unilaterally — frequent `/clear`s are a legitimate choice.
- **Checkpoint constantly** — append to `progress.md` and write per-run / per-iteration files as work happens, not at chunk end.
- **`/clear` proactively** — trigger checkpoint-and-`/clear` before context is tight. Erring early is correct — `/clear` is cheap because all state is on disk.

## User involvement

- **In** — approve the generated `test-spec.md` at the one Phase 1 checkpoint.
- **During** — drive the loop: at each `/clear`, let the zellij helper queue the resume prompt or paste it manually; answer the target skill's own prompts as the scenario record scripts them.
- **Out** — review the converged candidate's diff and `report.md`, approve promotion to the live skill.

## References

- `references/spec.md` — spec generation, the faithful-git-repo fixture, the scenario catalog, the gated/non-gating check split, and how a scenario run follows the candidate as a file.
- `references/evaluate-and-fix.md` — the judge, the failure classifier, the fixer and its simplification mandate, the final taste pass.
- `references/convergence.md` — stable defect ids, the regression suite, defect-rate convergence, the held-out branch, the iteration cap, stuck detection.
- `references/agent-prompts.md` — self-contained subagent prompt templates the orchestrator fills and dispatches.
