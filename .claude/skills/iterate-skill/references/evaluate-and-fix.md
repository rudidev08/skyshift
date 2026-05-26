# iterate-skill — evaluate and fix

This reference covers the **evaluate → classify → fix** half of one loop iteration. `references/spec.md` is the setup (the frozen spec); `references/convergence.md` is the other half (defect identity, the regression suite, when to stop).

One safety property governs everything here: **the agent that judges a run is never the agent that fixes the skill.** Independent eyes — a fixer cannot grade its own work, and the judge cannot quietly excuse a defect it would otherwise have to fix. The orchestrator itself neither judges nor fixes; it dispatches the judge and the fixer, routes their output, and checkpoints to disk.

An **iteration** is one fix cycle: a batch of scenario runs, each judged, then a single fixer pass over the contract defects those runs surfaced — followed by a re-run against the now-fixed candidate. `references/convergence.md` defines which runs an iteration covers.

## What a run is judged on

Three kinds of defect, from the design:

- **Orchestration integrity** — no stall, no lost or duplicated state, ledgers consistent, resume-after-`/clear` correct, phase hand-offs intact, a defined terminal state reached. Objective.
- **Objective contract conformance** — the run produced what `candidate/SKILL.md` verifiably requires: required fields present, no leaked rule codes, the right pass over the right files. Objective.
- **Judgmental conformance and taste** — anything that needs a judgment call to assess.

The first two are **gated checks**; the third is **non-gating notes**. `references/spec.md` Part 3 defines the buckets and the classification rule; the frozen `test-spec.md` carries the actual per-target check list. The judge evaluates against that list.

## The judge

The judge is an **independent subagent**, dispatched once per run — never the agent that fixes. Its prompt template is in `references/agent-prompts.md`.

**Inputs:**

- the run's transcript (`transcripts/<run-id>.md`, where `<run-id>` is defined in `SKILL.md`'s ledger format; the orchestrator writes the file itself per `references/spec.md`'s "Running a scenario" section);
- the target skill's own progress files, left in `workspace/` by the run (`workspace/.<target-skill-name>.local/progress.md`, `plan.md`, `notes/`, and the like);
- `test-spec.md` Part 3 — the checks to run;
- `candidate/SKILL.md` and its references — to locate the instruction behind any failure.

**Primary evidence is the target skill's own progress files.** A multi-phase, crash-resilient skill writes rich ledgers — per-outcome lines, plan generations, per-file notes — and most gated checks ask exactly what those ledgers record. The transcript is **secondary**: it covers only what no progress file holds — user-facing wording (the "no rule codes" check), the prompts the run asked, the terminal message. If a target skill's progress files turn out too thin for a check to be settled from them, that is itself a finding — the skill should be recording that state — surfaced, not worked around.

**What the judge produces, per run:**

- every **gated check the scenario exercises** → a binary pass/fail verdict;
- every **non-gating note** → a written observation (an assessment, not pass/fail);
- every gated-check **failure** → a *pinpoint* and a *classification* (below).

The judge returns its verdict block as text and a short summary, and writes nothing to disk; the orchestrator appends the verdict block to `iterations/iter-NN.md`. The judge never edits the candidate.

### The pinpoint

For each failed gated check, the judge writes a pinpoint — the precise hand-off to the fixer:

- **Defect id** — the stable structural id; full format (the five fields, including the `branch` axis that keeps held-out re-discoveries from colliding with fixture ledger entries) is defined in `references/convergence.md`. The id dedups a defect that surfaces in several runs and keys the regression suite.
- **Failed check** — the check id from `test-spec.md`.
- **Offending instruction** — the exact text quoted from `candidate/SKILL.md` (or the named reference file) that is at fault, with its file and a short anchor snippet. If the failure is a *gap* — the candidate says nothing about the situation — the pinpoint names the section where the missing instruction belongs.
- **Critique** — plain language: what the instruction fails to say, says ambiguously, or says wrongly, such that the run went wrong. The critique describes the *gap*; it does not prescribe the edit — the fixer decides the fix.
- **Evidence** — the specific progress-file line or transcript excerpt that shows the check failed.
- **Classification** — `contract` or `environment` (below).

### Classification — folded into the judge

A failed check is not always the skill's fault. Before anything reaches the fixer, each failure is classified. This is **folded into the judge**, not a separate agent: the judge already holds all the evidence — the transcript and the progress files — and a second agent re-reading the same evidence to attribute blame would be machinery for no gain.

- **`contract`** — the target skill's fault. The run followed `candidate/SKILL.md` and the bad outcome still resulted, or the candidate is silent or ambiguous on the situation. Contract failures get the fixer.
- **`environment`** — not the skill's fault. Sub-reasons: `flaky-subagent` (a subagent the run dispatched crashed or returned malformed output for reasons unrelated to its prompt), `rate-limit` (an API quota was hit), `fixture-error` (the fixture itself was malformed — a validation command that can't run, a rule file the spec should have included), `refusal` (the model refused part of the task), `harness` (a Claude Code tool error unrelated to the skill).

**The judge errs toward `environment` when attribution is unclear.** Mislabeling an environment failure as `contract` feeds a non-bug to the fixer, which then adds machinery — the exact disease iterate-skill exists to cure. Mislabeling a contract failure as `environment` only *delays* catching it: a real contract defect is roughly deterministic and resurfaces on the retry and across other runs. So the unsure case goes to `environment`, never to an unsure `contract`.

## Routing — who fixes what

The orchestrator routes each judge output:

- **Gated failure, `contract`** → the **fixer** auto-applies a fix to the candidate. This is the design's deliberate choice: automatic fixing only on the reliable, objective signal.
- **Gated failure, `environment`** → never written into the SKILL.md. Transient sub-reasons (`flaky-subagent`, `rate-limit`, `harness`) → retry the run, at most twice. A third `environment` failure on the same scenario-and-check is **surfaced to the user** as persistent — it may be a real defect the judge keeps mis-attributing, or a genuine environment problem only the user can clear. Structural sub-reasons (`fixture-error`, `refusal`) → surface immediately. A `fixture-error` means the *frozen spec* is wrong; since the spec is frozen, the orchestrator pauses and surfaces it — the user decides whether to reset with a corrected spec. It is never silently patched, because that would un-freeze the spec mid-run.
- **Non-gating note** → the judge's observation goes into `report.md` for the user. **Never auto-fixed** — judgment defects are the user's call, not the fixer's.

## After each judged run

When the judge returns, the orchestrator updates these on-disk artifacts before the chunk ends. This is the **one canonical list** — a `next-prompt.txt` resume checklist copies it, never re-derives it from the references:

- **`iterations/iter-NN.md`** — append the judge's returned verdict block (the judge writes nothing itself; the orchestrator owns this file).
- **`progress.md` run log** — append the run line: run id, scenario, gated pass/fail counts, any `contract` defect ids, environment-failure count.
- **`progress.md` defect ledger** — add or update an entry for every `contract` defect the run surfaced.
- **`regression-suite.md`** — add a replayable case for each *new* gated failure (`references/convergence.md`).
- **`report.md`** — append the run's non-gating observations and any surfaced environment failure under a `### Run <run-id>` header. The header keys the per-run section so a resume that needs to re-execute this list can detect "already written for `<run-id>`" by checking whether that header line is already present.

The fixer appends its own fix summary to `iterations/iter-NN.md` once per iteration — that write is the fixer's, not part of this per-run list.

## The fixer

The fixer is a **separate agent** — never the judge. Its prompt template is in `references/agent-prompts.md`. It is dispatched **once per iteration that has at least one `contract` pinpoint**, handed those pinpoints deduplicated by defect id (the same defect surfacing in five runs is one pinpoint, one fix — not five). An iteration with zero `contract` defects skips the fixer dispatch entirely; the Phase 2 loop in `SKILL.md` records that case as `fixer-pass iter-<NN>: no-defects` instead — the M-window does not reset, and the clean runs continue to count toward convergence (`references/convergence.md`).

The fixer writes a **planned-fixes block** to `iterations/iter-NN.md` BEFORE applying any edit, then applies, then updates the block's status to `applied` (or `flagged-only` if every pinpoint was flagged by the spec-drift or size-gate check). The block is the per-iteration audit trail: what was planned, what landed, what was flagged. Recovery from a mid-fixer crash is the orchestrator's job — SKILL.md's Phase 2 step 5 snapshots `candidate/` to `iterations/iter-NN-pre-fixer/` BEFORE dispatching the fixer, and on resume after a crash it restores `candidate/` from the snapshot and re-dispatches the fixer from the original pinpoints. The fixer therefore always runs against a clean candidate and never has to reason about partial prior edits. Full step list in `references/agent-prompts.md`. The fixer applies to `candidate/SKILL.md`, or to whichever candidate reference file a pinpoint's affected artifact names.

### The simplification mandate

The fixer works under a hard mandate, because an unconstrained fixer reproduces the exact failure mode the skill is meant to cure — each fix bolting on machinery that becomes the next iteration's bug.

- **Smallest fix.** Address exactly the pinpointed gap and nothing else. No drive-by edits, no nearby cleanup, no "while I'm here."
- **Clarify or remove before adding.** A defect almost always means an instruction is ambiguous, contradictory, or wrong — so the fix is almost always to *clarify* the offending instruction or *remove* the one that contradicts it. *Adding* a new rule is the last resort, taken only when the candidate is genuinely silent on a situation it must cover.
- **The size gate.** `progress.md` records the candidate `SKILL.md`'s line count at run start. The gate is computed once at that point as `min(start_lines × 1.10, 500)` — 10% growth from the starting size, capped at the skill-family ceiling of 500 lines, whichever is smaller. The orchestrator fills the fixer prompt's `<size-gate>` placeholder with that single number. The gate applies to every file a planned edit touches: for `candidate/SKILL.md` the ceiling is `<size-gate>`; for a reference file the fixer measures its current line count with `wc -l` and applies `min(current_lines × 1.10, 500)` as a per-file ceiling. If a planned edit set would push any touched file past its ceiling (the fixer projects the post-edit count per file by summing the line deltas for that file), the fixer does **not** apply them — it marks every remaining pinpoint `flagged — size gate`, the planned-fixes block in `iterations/iter-NN.md` records the flags, and `report.md` collects them for the user to decide. Unbounded growth is itself the disease; the gate makes the skill stop and ask rather than bloat silently.

The fixer never touches the live installed skill — only `candidate/`. Promotion to `.claude/skills/` is the user's separate, final step.

## The final taste pass

The gated loop deliberately cannot catch taste — convoluted prose, an instruction that is technically followed but reads badly, a fix that smells like added machinery. That is covered **once, at the very end** — in Phase 3, after the loop reports convergence and the held-out pass has run — by an independent multi-reviewer pass over the converged candidate.

The orchestrator runs an independent multi-reviewer pass on the converged `candidate/SKILL.md` and its diff from the original: `/triple-check` if available (the user's 3-way consensus review — two Claude agents plus codex), otherwise two or more independent reviewer subagents. Its findings — questionable instructions, machinery that crept in, prose that drifted — are appended to `report.md`.

The taste pass is **non-gating**: it never blocks promotion and never auto-fixes. It is independent — fresh reviewers, not the judge and not the fixer. It is advisory output for the user's final review.

## Where evaluation output lives

- `iterations/iter-NN.md` — one file per iteration: the judge's per-run verdict blocks, then the fixer's fix summary. Built up as the iteration runs, so it survives a `/clear`.
- `report.md` — the running user-facing report: non-gating observations, surfaced environment failures, size-gate-flagged fixes, and finally the taste-pass findings.

`references/convergence.md` covers how defect ids are formed, how the regression suite replays past defects, and how the loop decides it has converged or must stop.
