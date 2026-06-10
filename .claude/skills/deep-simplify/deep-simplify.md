## Deep simplification

Use this when stepping back from code to rewrite it simpler or clearer — the larger "this whole mechanism shouldn't exist" / "this complexity defends against a state we can't reach" judgment, not the per-rule cleanup `structure.md` governs. `structure.md` governs how new code is shaped; this governs removing complexity the runtime makes unnecessary, including changes that alter behavior **when a project-defined runtime invariant licenses them**.

The runtime-invariant license list is **per-project** and lives in the target repo's `dev/code-rules/deep-simplify.md`, read after this base guide as additions/overrides — the same base-guide-plus-project-supplement flow `structure.md` and `structure-comments.md` use. This file is project-agnostic: the moves, the behavior-change protocol, and the conservative bias hold in any repo. The invariants that *authorize* a behavior change do not — they are facts about one codebase. **Without a project license list, every change is behavior-preserving; no behavior-changing simplification is licensed.**

### Decision

Before keeping a mechanism, ask:

- Does a project runtime invariant make this complexity unnecessary?
- Is this deferred/lazy path here for a constraint this project doesn't have?
- Is this field stored when it's derivable from its siblings at the one place it's read?
- Is this re-validating data that's already trusted past a real boundary?
- Is this a parallel structure duplicating something already enumerated elsewhere?
- Would deleting it break a real runtime invariant, or only a hypothetical future?
- Do this module and the code it would merge into change for the same reasons and on the same cadence — no data-vs-render, persistence-vs-presentation, or boundary-vs-core split between them? (A shared shape across a real change boundary is not duplication — keep that seam.)
- Is the coupling this removes incidental, or domain-justified? Collapsing incidental coupling removes complexity; collapsing a domain seam relocates it.

If an invariant makes the mechanism unnecessary, the simplification is removing the mechanism — not making the mechanism tidier.

### The behavior-change boundary

Every proposed change is exactly one of:

- **Behavior-preserving** — rename, move, extract, collapse a wrapper, derive a value that provably resolves to the same result, convert units at the boundary. Describe the mechanism; no guard test required.
- **Behavior-changing** — removing a path, dropping coordination, changing a default, deleting persistence. Allowed **only** when it carries **all five**:
  1. **License** — names a specific runtime invariant from the target project's list (`dev/code-rules/deep-simplify.md`). No project list, or no invariant fits → not licensed; keep the behavior or find a behavior-preserving form. Don't invent a license.
  2. **Original purpose** — one sentence sourced from evidence, not invention: quote the local comment if it gives the real reason; else `git blame` the line and `git log -1` the introducing commit and quote that; else write "no surviving justification" (also useful evidence).
  3. **Verified against `<file:lines>`** — the specific code you read that proves the old path is actually unreachable under the cited invariant. The license is *grounded against the code*, not asserted. The documented failure mode of unverified rewrites is **sharpening**: a vague justification hardens into a specific false claim through paraphrase. Grounding it against the code is what stops that.
  4. **Announced change** — the change description (and commit subject, if committed) states what was replaced and the new mechanism, as a complete spec of the change.
  5. **Guard test** — a test, written or rewritten in the same change, that **fails or materially differs under the OLD behavior** — not merely one that passes for the new. The test names what it guards. When the licensed removal is of a path unreachable by construction (a dead branch past a real validation boundary, an accumulator whose carry-over can no longer occur), no test can drive the removed path with valid inputs — so here a compile-level difference (the old call's signature or arity no longer compiles) is a valid way to differ under the OLD behavior. This applies only to genuinely unreachable code; a path any valid input still reaches needs a test that differs at runtime.

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

Distinct ways to step back and simplify. Tag every proposal with its move. The examples below are portable toy examples; project supplements provide only runtime-invariant licenses and validation expectations.

- **M1 — Replace a complex mechanism with the plain local computation.** Delete a clever cross-cutting algorithm; substitute the obvious local form. Often behavior-changing.
- **M2 — Remove a denormalized/stored field; derive at the one read site; throw if the derivation contradicts the data.**
- **M3 — Centralize scattered constants/defaults into one typed registry consumers reference.** Replace duplicated inline literals/fallbacks.
- **M4 — Standardize units in names; convert at the boundary.** Behavior-preserving when the numeric result is unchanged.
- **M5 — Drop vague vocabulary; name the real contrast.**
- **M6 — Rename a type to encode its runtime relationship** (per-type catalog vs canonical template vs runtime-composed record).
- **M7 — Collapse a wrapper / one-line passthrough / cosmetic single-field type.**
- **M8 — Extract a shared helper from duplicated logic.** Bar: writing it a fourth time, or the name replaces a redundant comment (`structure.md` A.4) — not raw repetition count.
- **M9 — Rewrite a doc comment to scenario/effect, not mechanism.** Defer to `structure-comments.md`; flag it, don't both-edit-and-restructure in one opaque step.

### Recognition examples

Use these as shape examples, not as recipes to apply blindly. In a target repo, the proof still comes from the local code, the project license list, and the keep-signals above.

#### M1 — Replace a complex mechanism with the plain local computation

When you see a cross-cutting coordinator whose only purpose is a policy the project no longer wants, simplify to the local calculation and remove the coordinator.

Before:

```ts
function assignStartingStock(slots: InventorySlot[], targetFillRatio: number) {
  const slotsByItem = groupBy(slots, (slot) => slot.itemId);

  for (const itemSlots of slotsByItem.values()) {
    const targetTotal = totalCapacity(itemSlots) * targetFillRatio;
    distributeTotalAcrossSlots(itemSlots, targetTotal);
  }
}
```

After:

```ts
function randomizeStartingStock(slot: InventorySlot, random: RandomSource) {
  const fillRatio = random.between(0.25, 0.75);
  slot.quantity = Math.floor(slot.capacity * fillRatio);
}
```

Proof needed: a named runtime-invariant license, verified call sites showing no remaining consumer depends on the old coordination, an announced behavior change, and a guard test that differs under the old behavior. Do not apply when the coordinator preserves a real global invariant, such as a fixed economy-wide cap.

#### M2 — Remove a denormalized/stored field; derive at the one read site

When you see a field stored beside the fields that mechanically determine it, derive it at the single read or boundary site and fail there if the derivation contradicts the data.

Before:

```ts
interface Region {
  id: string;
  xMin: number;
  xMax: number;
}

interface PointConfig {
  id: string;
  x: number;
  regionId: string;
}
```

After:

```ts
interface PointConfig {
  id: string;
  x: number;
}

function regionForPoint(regions: Region[], point: PointConfig): Region {
  const region = regions.find(
    (candidate) => point.x >= candidate.xMin && point.x <= candidate.xMax,
  );

  if (!region) {
    throw new Error(`point ${point.id} is outside every region`);
  }

  return region;
}
```

Proof needed: every existing entry derives the same value the stored field used to name, and the failure mode is at the one boundary where the rule can break. Do not apply when the stored value represents separate user/designer intent.

#### M3 — Centralize scattered constants/defaults into one typed registry

When you see the same default or ordering rule repeated as inline literals, move the shared policy to one named registry.

Before:

```ts
const compactMode = loadPreference("compactMode", "true") === "true";
const showHints = loadPreference("showHints", "false") === "true";
```

After:

```ts
const preferenceDefaults = {
  compactMode: true,
  showHints: false,
} as const;

const compactMode =
  loadPreference("compactMode", String(preferenceDefaults.compactMode)) ===
  "true";
const showHints =
  loadPreference("showHints", String(preferenceDefaults.showHints)) === "true";
```

Proof needed: consumers are reading the same policy, not coincidentally equal local choices. Do not apply when the repeated value belongs to separate concerns that may diverge.

#### M4 — Standardize units in names; convert at the boundary

When you see a unit encoded inconsistently across data and runtime code, standardize the internal/data-side unit and convert only where an API requires another unit.

Before:

```ts
export const retryDelayMilliseconds = 5000;

setTimeout(retry, retryDelayMilliseconds);
```

After:

```ts
export const retryDelaySeconds = 5;

setTimeout(retry, retryDelaySeconds * 1000);
```

Proof needed: numeric behavior is unchanged after boundary conversion. Do not apply when the rename hides a real behavior change.

#### M5 — Drop vague vocabulary; name the real contrast

When you see umbrella words that do not explain the domain contrast, replace them with the actual distinction at each use site.

Before:

```ts
function collectAuthoredMessages(messages: MessageTemplate[]) {
  return messages.filter((message) => message.includeInCoreBundle);
}
```

After:

```ts
function collectCoreMessages(messages: MessageTemplate[]) {
  return messages.filter((message) => message.includeInCoreBundle);
}
```

Proof needed: each replacement preserves the intended contrast at the use site. Do not choose one global replacement for every occurrence.

#### M6 — Rename a type to encode its runtime relationship

When a type name hides whether it is a per-type catalog entry, canonical template, or runtime-composed record, rename it to match the relationship the runtime actually has with it.

Before:

```ts
interface WidgetTemplate {
  id: WidgetTypeId;
  label: string;
}

interface WidgetPlacement {
  widgetTypeId: WidgetTypeId;
  x: number;
  y: number;
}
```

After:

```ts
interface WidgetTypeTemplate {
  id: WidgetTypeId;
  label: string;
}

interface PlacedWidget {
  widgetTypeId: WidgetTypeId;
  x: number;
  y: number;
}
```

Proof needed: the rename matches how runtime instances relate to the data shape. Do not apply when the name is already a bare runtime instance type.

#### M7 — Collapse a wrapper / one-line passthrough / cosmetic single-field type

When a helper or local interface only restates an existing field or type without adding policy, use the direct field or native utility type.

Before:

```ts
function accountDisplayName(account: Account) {
  return account.name;
}

const label = accountDisplayName(account);
```

After:

```ts
const label = account.name;
```

Before:

```ts
interface GridSummary {
  width: number;
  height: number;
  cellSize: number;
}
```

After:

```ts
type GridSummary = Pick<Grid, "width" | "height" | "cellSize">;
```

Proof needed: no validation, conversion, caching, domain naming, or boundary is lost. Do not apply when the wrapper marks a real concern boundary or stabilizes a swappable dependency.

The same move applies to a parallel list rebuilt from an authoritative map or registry.

Before:

```ts
const assetUrlByKey = {
  click: "/audio/click.wav",
  success: "/audio/success.wav",
  warning: "/audio/warning.wav",
};

const assetKeys = ["click", "success", "warning"] as const;

for (const key of assetKeys) {
  preload(assetUrlByKey[key]);
}
```

After:

```ts
for (const url of Object.values(assetUrlByKey)) {
  preload(url);
}
```

Proof needed: the map is the complete enumerated set, not a larger registry from which the list intentionally selects a subset.

#### M8 — Extract a shared helper from duplicated logic

When repeated code performs the same operation and a helper name would replace a redundant explanatory comment, extract a shared helper.

Before:

```ts
ctx.globalAlpha = disabled ? 0.35 : 1;
ctx.strokeStyle = color;
ctx.beginPath();
ctx.moveTo(start.x, start.y);
ctx.lineTo(end.x, end.y);
ctx.stroke();
ctx.globalAlpha = 1;
```

After:

```ts
strokeGuideLine(ctx, start, end, { color, disabled });
```

Proof needed: the repeated sites have the same inputs, side effects, and lifecycle expectations. Do not apply when the code only looks similar but changes for different reasons.

#### M9 — Rewrite a doc comment to scenario/effect, not mechanism

When a comment explains implementation mechanics but not why the reader should care, rewrite it around effect, scenario, and boundary.

Before:

```ts
/** Stores retry count and delay values. */
interface RetryPolicyTemplate {
  maxAttempts: number;
  delaySeconds: number;
}
```

After:

```ts
/** Controls how long a failed request keeps trying before surfacing an error. */
interface RetryPolicyTemplate {
  maxAttempts: number;
  delaySeconds: number;
}
```

Proof needed: the comment makes the surrounding code easier to use without duplicating the implementation. Do not combine this with a structural rewrite in one opaque change.

### Rule codification

A refactor that establishes a naming/vocabulary/structure rule is not done until the rule is written into the project's coding docs (`AGENTS.md` / `structure.md` / `structure-comments.md` / this file's project half) **and** existing violations are swept in the same change. When a run surfaces such a rule, propose the doc edit + the sweep as one item.

### Conservative bias

- Under-propose. Over-flagging hypothetical edge cases is the failure mode — a guard for a state the runtime can't reach is exactly what this skill removes, not adds.
- A behavior-changing proposal missing any of the five (license, original purpose, verified-against, announcement, guard test) is dropped, not downgraded to "borderline."
- Don't manufacture invariants. The license list is the project's; a change that seems to need a license not on the list is a signal to keep the behavior, not to invent one.
- Performance-driven structure (caching, throttling, off-screen culling, pooling) can look like over-decomposition. If a comment cites a measurable cost, it stays.
