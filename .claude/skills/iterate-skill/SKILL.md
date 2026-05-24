---
name: iterate-skill
description: "[rp] Empirically test-and-fix another skill — run it on sample inputs in your session, evaluate each run for defects (stalls, lost state, bad resume, contract violations), fix its SKILL.md, and loop until it converges. User-initiated only; do not trigger on mentions of iterate-skill."
allowed-tools: Bash(bash ~/.claude/skills/iterate-skill/scripts/start-zellij-iterate.sh *), Bash(bash ~/.claude/skills/iterate-skill/scripts/zellij-clear-resume.sh *), Bash(mkdir:*), Bash(cp:*), Bash(rm:*), Bash(git:*), Bash(diff:*), Bash(printf:*), Bash(cat:*), Bash(grep:*)
---

# Iterate Skill

iterate-skill is an empirical **test-and-fix loop for other skills**. Pointed at a target skill, it runs that skill on sample inputs in your session, evaluates each run for defects — stalls, lost or duplicated state, a botched resume, a contract the run violated — pinpoints the offending instruction in the target's `SKILL.md`, fixes it, and loops until the skill runs cleanly.

This skill is **user-initiated**: only run it when explicitly invoked — via `/iterate-skill` or a direct request to iterate on a named skill. A passing mention of iterate-skill is not an invocation.

## The target skill — `$ARGUMENTS`

`$ARGUMENTS` names the target skill: a skill name, or a path to a skill folder. The target resolves the work-folder name (below). If `$ARGUMENTS` is empty and no work folder exists yet, ask the user which skill to iterate on — never pick one.

## How it runs the target skill

iterate-skill runs the target skill **in your normal interactive session** — not a `claude -p` subprocess and not a subagent, because the target skill dispatches its own subagents, which a subagent cannot do.

A scenario runs by **following the candidate `SKILL.md` copy as a file** — not by `/`-invoking the installed skill (`references/spec.md` covers the mechanism). The live skill in `~/.claude/skills/` is never touched until you approve promotion.

iterate-skill is **not unattended** — you drive it across `/clear`s. Zellij can automate the clear/resume keystrokes only after the user has started Claude inside zellij.

## Optional zellij driver

Zellij checkpoint automation is opt-in per run. The user must start Claude in a zellij session before invoking iterate-skill, usually from the target repo:

```
bash ~/.claude/skills/iterate-skill/scripts/start-zellij-iterate.sh
```

Do not try to move an already-running non-zellij conversation into zellij. The `/clear`-and-resume rhythm below covers both modes — step 3 branches on whether you are inside a zellij session started by `start-zellij-iterate.sh`.

## Work folder

`iterate-skill-<target-skill-name>.local/`, at the repo root. The name embeds the target so two iteration runs never collide; the `.local` suffix keeps it gitignored — the repo's `*.local/` pattern covers it (check once; add the line only if that pattern is absent).

Layout:

- `progress.md` — iterate-skill's own ledger and resume anchor (format below).
- `test-spec.md` — the frozen test spec: Inputs manifest, Scenarios, Checks (`references/spec.md`).
- `candidate/` — a full copy of the target skill folder; the artifact under test and the file set the fixer edits.
- `fixture/` — the faithful git repo the loop runs against; pristine after the spec is frozen.
- `held-out/` — the smaller held-out repo; the loop never runs against it.
- `workspace/` — the current run's working copy of a fixture; reset before every run.
- `regression-suite.md` — every defect found this run, each a replayable case (`references/convergence.md`).
- `transcripts/` — one captured transcript per run, `transcripts/i<N>-<scenario>-<seq>.md`.
- `iterations/` — one record per iteration, `iterations/iter-NN.md`: the judge verdicts, then the fixer summary.
- `next-prompt.txt` — the resume prompt for the next `/clear`.
- `report.md` — the running user-facing report; the final deliverable alongside the converged candidate.

### Ledger format — `progress.md`

`progress.md` is a header block plus four append-only logs:

```
# iterate-skill progress — <target-skill-name>

Target: <path to the live target skill>
Environment: model <id>, CLI <version>, <relevant settings>
Candidate size at start: <N> lines.  Size gate: <gate> lines.
Knobs: M=<M>, N=<N>, iteration-cap=<cap>.
Started: <date>.
Phase: <1 spec-generation | 2 loop | 3 termination>

## Run log
- run <run-id>: <scenario-id> — <P>/<T> gated pass; contract <defect-id,… | none>; env <count>

## Defect ledger
- <defect-id>: <open | fixed@iter-NN | stuck>; seen iter <N,…>

## Iteration markers
- iter-NN: <started | fixer-applied <count> | converged | cap-hit | stuck>

## Surfaced
- iter-NN: <environment failure | size-gate flag | stuck pause> — <one line>
```

The `Phase:` line is rewritten as the run advances; the four logs are append-only. Resume reads the `Phase:` line for where the run is, and the logs to reconstruct the run history, the open defects, and the iteration count. Nothing needed to resume lives only in context.

## Run start — fresh or resume

Before any work, check for `iterate-skill-<target-skill-name>.local/`.

- **Empty or absent.** Fresh run. Create the work-folder subtree, copy the target skill folder to `candidate/`, write the initial `progress.md` (header block, `Phase: 1`), and proceed to Phase 1.
- **Non-empty, `progress.md` missing or unreadable.** Stop and ask the user whether to reset; never guess at state.
- **Non-empty, `progress.md` valid.** Read it. Report back: the target, the phase, the iteration count, the open defects. Then continue from the recorded position — unless the invocation was a manual `/iterate-skill <target>` rather than a `next-prompt.txt` resume, in which case ask **resume** or **reset** first. A `next-prompt.txt` resume prompt is an explicit choice to resume — it skips the question.

On resume, everything needed is on disk: `candidate/`, `fixture/`, `held-out/`, `test-spec.md`, `regression-suite.md`, `iterations/`, `transcripts/`, and `progress.md`.

## The phases

### Phase 1 — Spec generation

Dispatch the spec-generation agents in **two waves** (prompts in `references/agent-prompts.md`) — the scenario catalog depends on the fixture, so its agent runs second. Wave 1: `contract-extractor` and `fixture-assembler` in parallel — both read only `candidate/`, and `fixture-assembler` builds `fixture/` and `held-out/`. Wave 2: `scenario-mapper`, which reads `candidate/`, the now-built `fixture/`, and Part 3's gated checks, so every scenario names real fixture files and declares which gated checks it exercises. Assemble the three agents' output into a draft `test-spec.md`. Show the draft to the user — **the one approval checkpoint before the loop.** Apply any adjustments in one revision pass, then freeze `test-spec.md`. Full detail: `references/spec.md`.

### Phase 2 — The iteration loop

Repeated, one `/clear`-bounded chunk at a time: reset `workspace/` from `fixture/`; run a scenario by following `candidate/SKILL.md` as a file; capture the transcript; dispatch the `judge` for that run; the judge evaluates and classifies. When an iteration's runs are done, dispatch the `fixer` over the iteration's deduplicated `contract` defects; then re-run. The judge, classifier, and fixer are in `references/evaluate-and-fix.md`; defect identity, the regression suite, convergence, and the termination conditions are in `references/convergence.md`.

### Phase 3 — Termination and report

The loop ends in exactly one of three ways — converged, iteration cap hit, or stuck (`references/convergence.md`). On convergence the held-out set runs once, then the final taste pass runs on the converged candidate (`references/evaluate-and-fix.md`). Finalize `report.md`.

### Install — a user step, never automatic

iterate-skill does not install. Present the converged `candidate/` — its diff from the original — and `report.md`. On the user's **explicit** approval, copy `candidate/` to `~/.claude/skills/<target-skill-name>/`. Editing `~/.claude/skills/` is the user's call alone — never promote without that explicit sign-off.

## The `/clear`-and-resume rhythm

A full target-skill run will not fit one context window, so iterate-skill works in small chunks, each bounded by a `/clear`. At each checkpoint:

1. Write all state to the work folder, so the `/clear` is safe — and reconcile `progress.md` with the current run: if the environment or plan changed mid-run, rewrite the header line and any run-specific section that named the old state, so no part of `progress.md` contradicts another.
2. Write the next resume prompt to `next-prompt.txt` as a **single line** — it must point only at on-disk state, never at context a `/clear` will empty. The zellij helper rejects multi-line prompts because embedded newlines would submit mid-prompt as separate turns.
3. If iterate-skill is running inside a zellij session started by `start-zellij-iterate.sh`, call `bash ~/.claude/skills/iterate-skill/scripts/zellij-clear-resume.sh <work-folder>/next-prompt.txt`. If the helper exits 0, say "Queued zellij `/clear` + `/effort max` + resume prompt." and stop the turn.
4. Otherwise — not inside zellij, or the helper exited non-zero for any reason — tell the user: "run `/clear`, then give me `<work-folder>/next-prompt.txt`". The user runs `/clear`, gives the file in their next message, and the new session reads it.

`next-prompt.txt` holds an explicit resume request, naming the target and the position — for example:

```
Resume iterate-skill for target <target-skill-name>. Work folder iterate-skill-<target-skill-name>.local/ — read progress.md and continue from the recorded position.
```

That is a direct user-initiated invocation; iterate-skill treats it as the choice to resume and continues without re-asking.

## Context discipline

This is a **hard requirement.** Quality drops as a context window fills, so iterate-skill must `/clear` **early, with healthy headroom — never running the context near full.**

The mechanism is structural, not a context-meter reading:

- **Small chunks.** Keep every `/clear`-bounded chunk to roughly one scenario run, or one judge-and-fix step. Do not let one chunk span several runs.
- **Checkpoint constantly.** Append to `progress.md` and write the per-run and per-iteration files as the work happens, not at chunk end.
- **`/clear` proactively.** Trigger the checkpoint-and-`/clear` before context is tight, not at the last moment. Erring early is correct — a `/clear` is cheap because all state is on disk.

## How the user is involved

- **In** — approve the generated `test-spec.md` at the one Phase 1 checkpoint.
- **During** — drive the loop: at each `/clear`, either let the zellij helper queue the resume prompt or paste it manually; answer the target skill's own prompts as the scenario record scripts them.
- **Out** — review the converged candidate's diff and `report.md`, and approve promoting the candidate to the live skill.

## References

- `references/spec.md` — spec generation, the faithful-git-repo fixture, the scenario catalog, the gated/non-gating check split, and how a scenario run follows the candidate as a file.
- `references/evaluate-and-fix.md` — the judge, the failure classifier, the fixer and its simplification mandate, and the final taste pass.
- `references/convergence.md` — stable defect ids, the regression suite, defect-rate convergence, the held-out branch, the iteration cap, and stuck detection.
- `references/agent-prompts.md` — the self-contained subagent prompt templates the orchestrator fills and dispatches.
