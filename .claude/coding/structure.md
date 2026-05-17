## Structure

### Decision

Before writing or growing a function, ask:

- Can this be more than one function with one clear purpose each?
- Could a name make this obvious instead of a comment?
- Is any of this defensive code for a problem that can't actually happen?

### Rules

#### Function size and decomposition

1. **Functions should fit in your head.** If you can't see the start and end of the body without scrolling, consider splitting.
2. **One thing per function.** If you can't name a function without "and," it is two functions.
3. **Extract instead of explaining a block.** When a block needs a `// what this does` comment to explain itself, pull it into a named function. The function name becomes the comment. Exception: keep section labels in HTML/DOM-building code and scenario narration in tests, even when they appear to restate the next line — mirrors the `coding/comments.md` exception.
4. **Three similar lines is fine.** The bar for extraction is "I'm writing it a fourth time" or "the function name would replace a redundant comment" — not raw repetition count. Extracting too early is more painful than extracting late.
5. **No abstractions for hypothetical reuse.** Wait until the second or third real call site before generalizing. This applies to extracting/generalizing helpers and APIs, not to renaming existing code for current clarity.
6. **Parameter count is a signal.** Functions with four or more parameters often mean either too much responsibility, or that some arguments belong together as one structured argument. Reach for the structured argument only when its fields form a coherent domain concept (e.g. a `ManagerDeps` with interdependent services) or call sites gain material readability from labeled keys — don't use one merely to dodge the four-parameter threshold.
7. **Boolean flag arguments are usually two functions.** A `bool` that fundamentally changes what the function does (`render(geometry, asGhost)`) is a sign you have two operations sharing one name. Split.

#### Control flow and nesting

1. **Cap nesting at 2-3 levels.** Deeper nesting is a signal — invert with early returns or extract.
2. **Guard clauses for preconditions.** Handle preconditions and edge cases up front and bail. Push the happy path to the left margin.
3. **No `else` after `return` / `throw` / `continue` / `break`.** The exit statement makes the `else` branch unnecessary nesting; continue at the outer level instead.
4. **Return early, return often.** Don't accumulate `let result` and return at the bottom when early returns work.
5. **No init-then-do ordering for our own APIs.** If our `init()` must run before our `do()`, encode that in the API shape (constructor takes the prereq, `do()` is a method on the result) rather than relying on the caller. When a constructor can't await its prereq, use an async factory function that returns the initialized object — don't expose a separate `init()` method. Framework-prescribed lifecycles are exempt — we don't get to reshape contracts the framework dictates. (Project-specific framework hooks: see AGENTS.md.)

#### Naming

1. **No short names, abbreviations, or acronyms by default.** Use full, easy-to-read names — for parameters, locals, fields, and types, not just exported APIs. Avoid shortenings like `snap` (→ `snapshot`), `cb` (→ `callback`), `idx` (→ `index`), `s` (→ `station`), `ts` (→ `tradeShip`), `orb` (→ `orbiting…`). Codebase-wide precedent doesn't override this. Exceptions: established technical vocabulary universally understood outside the repo (`Id`, `URL`, `JSON`, `HTML`, `DOM`, `UI`, `SVG`, `HUD`), loop counters (`i`, `j`), standard generic type variables (`T`, `K`, `V`), and math-convention single letters in geometry/physics code (`x`, `y`, `dx`, `dy`, `dt`).
2. **Rename instead of commenting.** A well-named function or variable replaces a comment. Reach for renaming first; see also `coding/comments.md`.
3. **Match in-repo precedent.** When a naming or structural convention isn't documented, prefer existing in-repo precedent over inventing a new one. If precedent is conflicting, ask.
4. **Pair operations should look paired.** load/save, register/unregister, attach/detach — same word root, same parameter shape, same return shape. Exception: serialize/deserialize and inverse transformations (e.g. `toSnapshot`/`fromSnapshot`) may have asymmetric return shapes by nature — serialization returns data, deserialization returns the reconstructed value. Asymmetry in non-inverse pairs is a sign something is off, or a missing rule.
5. **Make mutation visible in the name.** `addShip`, `clearQueue`, `setPhase` for functions that mutate. `withShip`, `nextPhase` for functions that return new values. If `getShip()` mutates anything, rename it.
6. **Names on exported shapes carry meaning at consumer sites.** A name read across files needs to read cleanly without seeing its declaration. Applies to fields and to exported type names. `fromId` is fine when the consumer reads it next to a type name like `TradeRoute`; `fromStationId` is right when the field escapes to consumers that read `route.fromId` in isolation. Same for type names: qualify the export (`GameViewMode` over bare `ViewMode`) when the bare name has a real plausible collision in the consuming codebase; otherwise let the import path or a namespace import (`import * as game from "./game-view-mode"; game.ViewMode`) carry the scope. Don't qualify pre-emptively.
7. **Renames are present-clarity edits, not abstractions.** When a name reads better, take it. Don't cite A.5, A.4, D.3, C.3, call-site count, or "churn" as a reason to keep an unclear name — those rules govern new code, not relabeling existing code.

#### Don't write code that doesn't need to exist

1. **No defensive guards or compat shims for hypothetical futures.** Don't add validators, error guards, defensive cleanup, polymorphism, or compat shims for problems that can't happen. Defensive code is justified by runtime correctness — typos, malformed in-process state, rules the code expects to always hold that it could itself violate. Not by "what if a future schema" or "what if a hand-edited save." This bans cleanup-for-impossible-states; lifecycle cleanup when a real lifecycle exists (destroying framework objects, `removeEventListener`, disposing subscriptions, clearing timers) is required, not defensive.
2. **Validate at boundaries when there really is a single boundary.** User input and external APIs always get validation. Internal code is trusted unless there is a real runtime risk under the rule above (typos, malformed in-process state, rules the code expects to always hold). When a rule must hold and only one place can break it — for example, a string-keyed registry lookup — validate at that one place rather than layering guards through every consumer. (Project-specific boundary validators: see AGENTS.md.)
3. **Stay in scope.** Don't add features, refactor, or introduce abstractions beyond what the task requires. A bug fix doesn't need surrounding cleanup. A one-shot operation doesn't need a helper.
4. **No half-finished implementations.** If you can't ship it now, don't leave the scaffolding. No empty branches with `// TODO: implement`. No commented-out next steps.
5. **No cosmetic wrapper types.** Don't wrap a type in a single-field object just to hand it through. When the runtime adds fields to a known shape, compose with intersection or extension instead of `{ template, extras }`. Example: `interface Trip { legs: TripLeg[] }` should collapse to `TripLeg[]` when consumers always peel `trip.legs`.

#### Layout within a function

1. **Declare close to first use.** Variables go near where they're used, not at the top of the function.
2. **Blank lines beat dividers.** Group related statements; use a blank line between groups instead of a section-divider comment. (See `coding/comments.md` for the dividers-must-carry-information rule.)
3. **One concept per line.** Don't pack three transforms into one expression when separate steps read better.

#### Side effects

1. **Isolate side effects from pure logic.** When a function reads or writes external state (DOM, shared mutable state, IO), keep that work in one place rather than threading it through pure logic.

#### File size as a signal

1. **A large file is a signal, not a verdict.** File size is a hint that something might be wrong, not a reason to split on its own. When a file passes a few hundred lines, look at what's inside — split only if there are two or three separable concerns. A large file that owns one cohesive responsibility stays as it is. When a split is right, helpers stay private in their host file first; extract to a sibling only when there's a real second consumer or when each piece is a separable cohesive concern of equal weight. New files follow project-specific naming conventions and architecture boundaries, with imports flowing in one direction across boundaries. (Project-specific cluster names and import rules: see AGENTS.md.)

### Forward-looking refactor decisions

When reviewing or refactoring, default to "what makes the repo better long-term," not "what's there today." C.3 ("match in-repo precedent") guides WRITING new code; for review/refactor, treat existing precedent as evidence about what to sweep, not as a veto on improvement.

When presenting options to the user, label which path each represents:

- **Preserve current pattern** — keeps in-repo consistency; no churn; cost is zero today.
- **Forward-looking change** — sets a better precedent for future development; current churn; pays off as the codebase grows.

The user picks; the presenter's job is to make the trade-off visible. Don't bury the forward-looking option behind framing like "it's borderline" or "it would touch X files" — present both as real options and let the user weigh churn vs. payoff.

### Example 1

Prefer `scoreStationTypeForNewConstruction` — the name says when this score applies; there's no universal score for a station type, so the context belongs in the name.

Avoid `scoreStationType` — raises the question "scored against what?" — production efficiency? sale value? build priority?

Additional prefer/avoid example: `computeMapWareScarcity` / `computeWareScarcity` (name should also say the scope).

Additional prefer/avoid example: `cameraMinZoomPhaserClamp` / `cameraMinZoom` (when a same-file sibling like `cameraZoomLevelMin` competes, the bare name leaves "min zoom for which system?" ambiguous at the declaration; the `PhaserClamp` suffix names the consumer so the two constants can't be confused on first read).

### Example 2

Prefer `startNextStationBuild` — "Next" makes the per-tick invocation pattern visible; pairs with `startInitialStationBuilds` (one-shot at game start) to distinguish the two entry points.

Avoid `startBuild` — leaves "build of what?" and "when does this run?" unanswered; reader has to scan callers to learn whether the function fires once, repeatedly, or only on demand.

### Example 3

Six helper names extracted from `createStationVisualBundle` — each says what's built and what's returned:

- `drawStationBaseLayer`, `drawStationOverlayLayer` — "Layer" because each creates both a canvas texture and a Phaser Image; `drawStationBaseTexture` would hide the Image.
- `createStationIconImage` — single Image returned.
- `createInventoryRingTwinkles`, `createInventorySegmentTwinkles` — paired naming for paired helpers.
- `buildInventoryRingLayout` — "Layout" because the function returns slots + producedIds + segmentArcs; `buildSortedInventorySlots` would pivot on one return field and hide the other two.

### Example 4

Prefer (early returns precede the placement call):

```ts
const decision = this.pickNextBuildType(nation, occupiedZoneIds);
if (!decision) return null;
const zone = this.pickPreferredBuildZone(nation, decision.typeId, occupiedZoneIds);
if (!zone) return null;
return this.stationManager.placeBuild({ /* ... */ });
```

Avoid (nests the productive call so both else-paths return null):

```ts
if (decision) {
  if (zone) {
    return this.stationManager.placeBuild({ /* ... */ });
  }
}
return null;
```

### Example 5

Prefer (one structured argument with 5 coherent fields shared by `addStation` and `removeStation`):

```ts
export interface AddStationDependencies {
  mapState: MapEditorState;
  nationById: Map<string, Nation>;
  simulationSession: EditorSimulationSession;
  markMapEditorNeedsRemount: () => void;
  refreshDerivedPanels: () => void;
}
export function addStation(dependencies: AddStationDependencies) { /* ... */ }
export function removeStation(stationIndex: number, dependencies: AddStationDependencies) { /* ... */ }
```

Avoid (5 positional params; signature creeps over the 4-param threshold and labels disappear at call sites):

```ts
export function addStation(
  mapState: MapEditorState,
  nationById: Map<string, Nation>,
  simulationSession: EditorSimulationSession,
  markMapEditorNeedsRemount: () => void,
  refreshDerivedPanels: () => void,
) { /* ... */ }
```

### Example 6

Prefer (one helper, one call site — the three returned values describe the same ring's layout):

```ts
const { sortedSlots, producedIds, segmentArcs } = buildInventoryRingLayout(station);
```

Avoid (three helpers for one composed concern; caller threads `producedIds` and `sortedSlots` between calls):

```ts
const producedIds = buildProducedIds(station);
const sortedSlots = sortStationInventorySlots(station, producedIds);
const segmentArcs = computeSegmentArcs(sortedSlots);
```

### Example 7

Prefer the `sim-ship-action-*` codec split — 5 sibling files, one per action type, each owning that type's snapshot encode/decode:

- `sim-ship-action-fly.ts`
- `sim-ship-action-wait.ts`
- `sim-ship-action-cargo-withdrawal.ts`
- `sim-ship-action-cargo-deposit.ts`
- `sim-ship-action-decommission.ts`

A 5-case dispatcher in `sim-trade-manager.ts` routes by `action.type`.

Avoid keeping all 5 codecs inline in `sim-trade-manager.ts` — once each case carries its own encode + decode shape, the per-type codecs are separable concerns and belong in sibling files.

### Example 8

Prefer `restoreSavedGame` — names the actual scenario that fires this branch (player loads a saved game from `/universe` or from the settings panel's slot picker). The reader knows when this code runs without opening the body or grepping callers.

Avoid `applySnapshotPath` — "path" is overloaded in a game with ships (a ship has a flight path), and "snapshot" is internal jargon for the save format; the name describes code structure rather than the player-facing scenario.

Lesson: when naming a branch handler, identify the real-world scenarios that drive into the branch (look at the call graph), then name from those. Programmer jargon ("snapshot path", "fresh-init path") describes the code structure but obscures the scenario.

Additional prefer/avoid example: `startFreshUniverse` / `applyAuthoredSeedPath`.

### Example 9

Prefer `addDeliveryToTotals(event, totals)` and `buildRouteStatsFromWareTotals(routeTotals)` — plain-English verbs and content nouns. The reader pictures the operation immediately: a delivery's numbers go into running totals; route stats are built from per-ware totals. The `FromWareTotals` suffix names the input shape so the call site reads as a sentence.

Avoid `accumulateDeliveryEventIntoRouteIndex` and `routeIndexEntryToRouteStats` — programmer jargon ("accumulate", "index", "entry") describes data-structure shape, not content. "Index" doesn't say what's inside; "entry" is generic. The reader has to decode each token before picturing the operation.

Lesson: name data-transformation helpers with everyday verbs (add, build, sum, find, count) and content nouns (totals, stats, wares) — not programmer vocabulary (accumulate, merge, index, tally, roll up, normalize). When a helper takes structured input and produces structured output, the `Build X From Y` shape lets call sites read as English sentences.

Additional prefer/avoid example: `generateUniqueShipCode` / `mintUniqueShipCode` (don't import verbs from unrelated domains).

### Example 10

Prefer `tickDepartingPhase(flight, departEnd)` — `tick` matches the per-tick semantics already established in the codebase (`Simulation.tick`, `EmigrationManager.tick`, `tickEmigrantLaunches`). The helper fires every sim tick while the phase is active.

Avoid `advanceDepartingPhase` — "advance" is the right verb for *clock* or *queue* advancement (`advanceTradeTime`, `advanceQueue`, `EconomyTimer.advance`), where a single call moves an accumulator forward by an amount. A per-tick handler isn't moving by an amount; it's running once per tick, so the verb should match the cadence.

Lesson: pick distinct verbs for per-tick handlers vs. clock/queue advancement, and use them consistently — the verb tells the reader what cadence the caller expects. Match your project's convention; consistency matters more than the specific verb pair. (This project's verb assignment: see AGENTS.md.)

### Example 11

Prefer `canShipCarryAnyWareThatStationUses(station, shipTemplate)` — verbose, but the name *is* the predicate being asked at the call site: `if (!canShipCarryAnyWareThatStationUses(station, shipTemplate)) return [];`. "Any" and "Uses" both carry meaning — they capture the OR-relation across the station's produces and consumes.

Prefer also `getProducedWareIdsForStationType(stationType): Set<WareId>` — same shape applied to a cache-backed lookup helper.

Avoid `shipCanTradeForStation` or `shipFitsStation` — terser but lossy. "Trade for" doesn't preserve the "any ware overlap with any side of the economy" semantic; "fits" is too vague to test against without opening the body.

Lesson: a long predicate name is fine when every word in it does real work. Don't abbreviate a name to the point where the reader has to open the body to understand the predicate. The bar for shortening is "every dropped word was redundant," not "the name is X characters long."

Additional prefer/avoid example: `cargoAmountByWareId` / `cargoEntries` (quantity and key both matter).

### Example 12

Prefer `createZoneFromDefinition(definition, sectorsById, takenCodes)` — plain "create Y from X" naming for a data-hydration helper (authored data → runtime instance). Reads as English at the call site. Matches `createStation(placement)` already in the codebase, where the JSDoc reads "Create a full runtime `Station` from an authored `StationPlacement`."

Avoid `buildStationZone(definition, ...)` — when a project reserves a verb for a specific operation (here `build` is reserved for station-construction-action vocabulary like `placeBuild`, `startNextStationBuild`, `Station.build`), reusing that verb for unrelated operations makes both meanings ambiguous. A reader can't tell from the name whether the helper produces a runtime instance or kicks off the reserved action.

Lesson: name data-hydration helpers `createXFromY`, and write their JSDoc as "Create runtime X from authored Y." Don't reuse a verb your project reserves for another concept; avoid programmer jargon ("inflate", "hydrate") when a plain verb fits. (Project-specific reserved/rejected vocabulary: see AGENTS.md.)

### Example 13

Prefer `surfaceOrOrbit: "surface" | "orbit"` — the field name names the value set, so a consumer reading `endpoint.surfaceOrOrbit === "surface"` sees the closed set without consulting the type. Works because the values *are* the meaning, not categories of an underlying domain.

Avoid `phase: "surface" | "orbit"` — bare `phase` collides with the lifecycle-stage `FlightData.phase` (`"departing" | "hyperjump" | "arriving"`) at sites that read both fields in one expression (`flight.phase === "departing" && flight.origin.phase === "surface"`); the field name can't disambiguate the two `.phase` fields for the reader.

Avoid `locationType: "surface" | "orbit"` — works, but the "Type" suffix asks the reader to bridge from a category name to the value set when the values themselves could carry the name; adds an abstraction layer with no payoff.

Lesson: with a small closed set of two or three literal values, naming the field after the values (`surfaceOrOrbit`, `incomingOrOutgoing`) can read clearer than abstracting to a category name (`locationType`, `direction`, `kind`). Use sparingly — fits only when the values are the meaning, not categories of an underlying domain. With more values, or when values are categories of something else (e.g. `stationType` whose values are categories of stations), prefer a category name.

### Example 14

Prefer `export const iconSvgByStationType: Record<StationTypeId, string> = { ... }` — TypeScript enforces "every station type has an icon" at compile time, in one place. Adding a new station type without an icon fails the build at the registry literal.

Avoid `Partial<Record<StationTypeId, string>>` — the `Partial` says "some keys might be missing." Even if every key IS present today, the `| undefined` return propagates through every consumer: `renderStationIconDataUri` returns `string | undefined` → `getStationIconTextureKey` mirrors → `buildStationIcon` mirrors → `getStationHudIcon` adds `?? ""` (silent empty string, would set `<img src="">`) → `createStationIconImage` adds an invisible-placeholder branch with a comment explaining "stations that have no authored icon." Five files all defending against a state the registry literally constructs.

Lesson: when an object literal IS the canonical mapping for every value in a union, type it as `Record<X, Y>` and let the compiler enforce completeness at the registry. Reserve `Partial<Record<X, Y>>` for genuinely sparse mappings; for those, consider whether `Map<X, Y>` reads cleaner. The cost of `Partial` is `undefined` propagation through every consumer + scattered defensive guards in places where the registry's own data already says the value exists.

### Example 15

Prefer `formatRatePill(rate, rateLabel): string` — the helper is being added to `util-quantity-format.ts`, where every existing export already uses `format*` (`formatDuration`, `formatQuantity`, `formatRateValue`, `formatCargoBar`). The new helper matches the file's own grammar.

Avoid `buildRatePillHtml(rate, rateLabel): string` — at first read this matches a perfectly valid pattern from the editor cluster's recent extracts (`buildStationRow`, `buildShipsTableHeaderHtml`, `buildWareRowsHtml`). But that pattern is one cluster's, not this file's. Importing it puts a `build*Html` helper next to four `format*` siblings inside the same file — a reader scanning the exports has to ask "why does this one helper use a different verb?" with no answer in the file.

Lesson: when multiple in-repo precedents apply, the host file's existing pattern is usually the strongest. A reader opening one file sees the file's own grammar before they see any cluster-wide convention. C.3's "match in-repo precedent" is honored more by the nearest precedent than the broadest.

### Example 16

Prefer `secondsSinceLastTick` — the name says the unit (seconds) and the meaning (since last tick).

Avoid `subTickTimeDebt` — "Sub-tick time" doesn't carry a unit (seconds? milliseconds?). "Debt" implies a sign convention (in-debt → paid-back), which doesn't match the field — it's just a numeric measurement. The reader has to open the field's writers to learn what the value actually holds.

Lesson: prefer unit + meaning ("seconds since last tick", "pixels per second", "milliseconds until expiry") when they read clearer than a mechanism word. Mechanism names sometimes work but can imply constraints that don't match — "Debt" implies a sign convention, "Buffer" implies bounded capacity.

Additional prefer/avoid example: `mirrorSimEntitiesInRender` / `wireEntityRenderObservers` (purpose, not mechanism).

