## Comments

Add a comment when the WHY is non-obvious. Keep it short: one sentence by default; longer only when situation, reason, and breakage matter.

### Decision

Before adding a comment, ask:

- Would renaming or extracting make the code clear instead?

### Rules

- Use `/** */` JSDoc on **structural declarations**: types, interfaces, enums, classes, functions, methods, and fields. The rule is consistent regardless of `export`.
- Use `//` on **variable declarations** (including module-level `const`) and for inline notes. Exception: an exported `const` may take JSDoc when the value is a public knob importers benefit from seeing in hover-docs (e.g. tunable thresholds).
- Avoid comments that merely repeat names, types, control flow, or the next line of code.
- Judge 'obvious' by reader glance, not syntax — a label can anchor a long block even when each line is simple.
- Exception to the two rules above: keep section labels in HTML/DOM-building code, and keep comments in test files (scenario, setup-step narration, expected-outcome notes) even when they appear to restate the next line — tests are read more than they're written.
- Comments and code are paired. When editing either, verify the other still matches — read the code before rewriting a comment, and update or delete a comment when its code changes. Don't paraphrase comment-to-comment; that's how stale claims propagate.
- Check if a phrase is used elsewhere in the project, since it might be project-specific vocabulary — match the established term when writing, preserve it when rewriting. (Project-specific reserved/rejected vocabulary: see AGENTS.md.)
- Prefer plain English over programmer jargon. "Safe to call more than once" beats "idempotent"; "does nothing" beats "no-op"; "cached per X" beats "memoized by X"; avoid fluff like "load-bearing" — say what work the thing is doing. Jargon is fine when it's project vocabulary used elsewhere in the codebase (per the rule above).
- If you hit an existing comment that violates these rules in code you're already editing, delete or fix it. Don't preserve bad comments out of caution.
- Lead with the purpose, then the rationale. The first phrase should say what the comment is about. `// UI throttling — cuts setText calls` is easier to scan than `// Cuts setText calls; values are throttling intervals.`
- Shortening isn't the only edit — a thin comment may need lengthening, a mechanism-first one flipped to purpose-first. Don't pad — only add the fact the existing comment doesn't say.

### Example 1

Prefer (leads with the non-obvious why; the type name already says "production input", so the comment doesn't restate it):

```ts
/** Station input storage holds one hour of production demand, derived in src/sim-ware-template.ts. */
export type WareProductionInput = {
```

Avoid (restates the type name and over-explains a field):

```ts
/** Used as ingredient to produce a ware. The input buffer holds 1 hour of consumption, sized via `EconomyConfig.targetFillTime`. */
export type WareProductionInput = {
```

### Example 2

Prefer (concrete precise language):

```ts
// Sorted by id. Game views rely on this order.
export const allWares: WareTemplate[] = [
```

Avoid (abstract wording):

```ts
// Canonical iteration order — alphabetical by id. Display sites trust this
// ordering and don't re-sort.
export const allWares: WareTemplate[] = [
```

### Example 3

Prefer (concise, communicates dense data reader cares about):

```ts
// Refined (single input) — medium quantities, 2:1 reduction from raw
export const water: WareTemplate = {
```

Avoid (repeats category name without useful data):

```ts
// Refined wares
export const water: WareTemplate = {
```

### Example 4

Prefer (names the concrete scenario and the bad outcome it prevents):

```ts
// While we were waiting on buffer loads, the user may have clicked another
// station/ship or toggled audio off. If so, bail out before scheduling any
// sound — otherwise the stale sequence would play on top of the new one,
// since stopAnnouncement() can't cancel sources we haven't created yet.
```

Avoid (names internal mechanism — reader has to reverse-engineer what could go wrong):

```ts
// Generation guard after every await — a newer selection (or audio toggle)
// bumps playbackGeneration, and stale sequences must abort before scheduling.
```

Additional example: include the *why* ("so production doesn't all land on the same frame"), not just the *what*.

### Example 5

A divider with information past the label is not a divider. Keep the information, drop the label.

Before:

```ts
// Trade — ships orbit idle, then periodically run a trade route
tradeWaitMin: 2,
```

After:

```ts
// Ships orbit idle, then periodically run a trade route.
tradeWaitMin: 2,
```

### Example 6

Before:

```ts
/** Storage = base rate × (targetFillTime / simulationInterval). */
export const EconomyConfig = {
  simulationInterval: 0.5,
  targetFillTime: 3600,
  ...
};
```

After:

```ts
/** Current config sizes station storage to hold 1h of production. */
export const EconomyConfig = {
  simulationInterval: 0.5,
  targetFillTime: 3600,
  ...
};
```
