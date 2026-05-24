## Deep simplification

Use this when stepping back from code to rewrite it simpler or clearer — the larger "this whole mechanism shouldn't exist" / "this complexity defends against a state we can't reach" judgment, not the per-rule cleanup `structure.md` governs. `structure.md` governs how new code is shaped; this governs removing complexity the runtime makes unnecessary, including changes that alter behavior **when a project-defined runtime invariant licenses them**.

The runtime-invariant license list is **per-project** and lives in the target repo's `dev/code-rules/deep-simplify.md`, read after this file as additions/overrides — the same global-then-project layering `structure.md` and `structure-comments.md` use. This file is project-agnostic: the moves, the behavior-change protocol, and the conservative bias hold in any repo. The invariants that *authorize* a behavior change do not — they are facts about one codebase. **Without a project license list, every change is behavior-preserving; no behavior-changing simplification is licensed.**

### Decision

Before keeping a mechanism, ask:

- Does a project runtime invariant make this complexity unnecessary?
- Is this deferred/lazy path here for a constraint this project doesn't have?
- Is this field stored when it's derivable from its siblings at the one place it's read?
- Is this re-validating data that's already trusted past a real boundary?
- Is this a parallel structure duplicating something already enumerated elsewhere?
- Would deleting it break a real runtime invariant, or only a hypothetical future?
- Do this module and the code it would merge into change for different reasons or on different cadences (data vs render, persistence vs presentation, boundary vs core)? A shared shape across a real change boundary is not duplication — keep the seam.
- Is the coupling this removes incidental, or domain-justified? Collapsing incidental coupling removes complexity; collapsing a domain seam relocates it.

If an invariant makes the mechanism unnecessary, the simplification is removing the mechanism — not making the mechanism tidier.

### The behavior-change boundary

Every proposed change is exactly one of:

- **Behavior-preserving** — rename, move, extract, collapse a wrapper, derive a value that provably resolves to the same result, convert units at the boundary. Describe the mechanism; no guard test required.
- **Behavior-changing** — removing a path, dropping coordination, changing a default, deleting persistence. Allowed **only** when it carries **all five**:
  1. **Cited license** — names a specific runtime invariant from the target project's list (`dev/code-rules/deep-simplify.md`). No project list, or no invariant fits → not licensed; keep the behavior or find a behavior-preserving form. Don't invent a license.
  2. **Original purpose** — one sentence sourced from evidence, not invention: quote the local comment if it gives the real reason; else `git blame` the line and `git log -1` the introducing commit and quote that; else write "no surviving justification" (also useful evidence).  3. **Verified against `<file:lines>`** — the specific code you read that proves the old path is actually unreachable under the cited invariant. The license is *grounded against the code*, not asserted. The documented failure mode of unverified rewrites is **sharpening**: a vague justification hardens into a specific false claim through paraphrase. Grounding it against the code is what stops that.
  4. **Announced change** — the change description (and commit subject, if committed) states what was replaced and the new mechanism, as a complete spec of the change.
  5. **Guard test** — a test, written or rewritten in the same change, that **fails or materially differs under the OLD behavior** — not merely one that passes for the new. The test names what it guards.

A change that can't meet all five is reduced to a behavior-preserving form or dropped. Conservative bias: a simplification you can't ground is not a simplification.

### Keep-signals (do not collapse these)

Some structure looks like accidental complexity but is the complexity the problem demands. A candidate that hits one of these is kept and recorded under `Borderline-kept`, never proposed — even when it reads as a thin wrapper or a near-duplicate:

- A seam that makes a third-party or external service swappable for tests — a small adapter whose only job is substitutability.
- Canonical validation where untrusted input genuinely crosses into the program — collapse re-validation *behind* that boundary, never the boundary check itself. (Re-validating data already trusted past the boundary is a remove-signal per Decision; this protects only the one real entry check, not redundant downstream guards.)
- A documented public API contract under an explicit stability promise — a shape external consumers depend on across versions. (Internal cross-module or cross-entry shapes that can be co-edited are normal coupling, governed by the import-direction/cadence signals below, not this.)
- Two modules that change for different reasons or on different cadences (data vs render, persistence vs presentation, boundary vs core). They look mergeable; merging them couples two independent change rates.
- A boundary between genuinely separate concerns the project has deliberately drawn — the import-direction and file-cluster rules in the project's `AGENTS.md`.

When unsure whether a seam is real or incidental, keep it and flag it borderline rather than propose the collapse. This is the conservative bias applied to architecture, not just to per-mechanism guards.

### Moves

Distinct ways to step back and simplify. Tag every proposal with its move. Concrete before/after worked examples are project-specific — see the target repo's `dev/code-rules/deep-simplify.md`.

- **M1 — Replace a complex mechanism with the plain local computation.** Delete a clever cross-cutting algorithm; substitute the obvious local form. Often behavior-changing.
- **M2 — Remove a denormalized/stored field; derive at the one read site; throw if the derivation contradicts the data.**
- **M3 — Centralize scattered constants/defaults into one typed registry consumers reference.** Replace duplicated inline literals/fallbacks.
- **M4 — Standardize units in names; convert at the boundary.** Behavior-preserving when the numeric result is unchanged.
- **M5 — Drop vague vocabulary; name the real contrast.**
- **M6 — Rename a type to encode its runtime relationship** (per-type catalog vs canonical template vs runtime-composed record).
- **M7 — Collapse a wrapper / one-line passthrough / cosmetic single-field type.**
- **M8 — Extract a shared helper from duplicated logic.** Bar: writing it a fourth time, or the name replaces a redundant comment (`structure.md` A.4) — not raw repetition count.
- **M9 — Rewrite a doc comment to scenario/effect, not mechanism.** Defer to `structure-comments.md`; flag it, don't both-edit-and-restructure in one opaque step.

### Rule codification

A refactor that establishes a naming/vocabulary/structure rule is not done until the rule is written into the project's coding docs (`AGENTS.md` / `structure.md` / `structure-comments.md` / this file's project half) **and** existing violations are swept in the same change. When a run surfaces such a rule, propose the doc edit + the sweep as one item.

### Conservative bias

- Under-propose. Over-flagging hypothetical edge cases is the failure mode — a guard for a state the runtime can't reach is exactly what this skill removes, not adds.
- A behavior-changing proposal missing any of the five (license, original purpose, verified-against, announcement, guard test) is dropped, not downgraded to "borderline."
- Don't manufacture invariants. The license list is the project's; a change that seems to need a license not on the list is a signal to keep the behavior, not to invent one.
- Performance-driven structure (caching, throttling, off-screen culling, pooling) can look like over-decomposition. If a comment cites a measurable cost, it stays.
