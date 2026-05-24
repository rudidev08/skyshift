// Catches new fields silently entering save files.
//
// The test captures a snapshot from a 120-tick settled-preset sim, walks the
// JSON tree, collects every distinct field path (array indices collapsed to
// `[]`), and compares the resulting set against the list in
// `savegame-snapshot-paths.json`. If a runtime field gets added — e.g.
// `currentRenderHeading` on `FlightData` — and a snapshot codec spreads
// `{...trade.flight}` somewhere, the new path appears in the captured set
// and the test fails with `+ tradeShips[].flight.currentRenderHeading`.
//
// The author decides:
//   - intentional schema change → regenerate `savegame-snapshot-paths.json`
//     with the new set.
//   - accidental leak → find the spread and either drop the runtime field
//     from the snapshot path or opt it into the matching `Pick<...>` in
//     `sim-save-types.ts`. The `Pick<>` discipline there is the compile-time
//     backstop; this test is the runtime backstop for new snapshot types
//     written as plain interfaces that bypass it.
//
// The 120-tick run exercises trade-related branches (mid-flight ships,
// queued actions, reservations) that a freshly-spawned sim wouldn't cover.
// The captured field path set is deterministic across runs even though sim
// values aren't — values vary with `Math.random`, but the set of fields
// touched does not.

import { readFileSync } from "node:fs";
import { test } from "./test-utils.ts";
import { captureSnapshot } from "../ui-savegame-manager.ts";
import { setupFreshTestGame, stripVolatileSnapshotFields } from "./savegame-test-fixtures.ts";

/** Walk a JSON-able value and add every distinct field path to `paths`,
 *  collapsing array indices to `[]`. The resulting set is independent of
 *  array element values and counts. */
function collectFieldPaths(value: unknown, prefix: string, paths: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectFieldPaths(item, `${prefix}[]`, paths);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, subValue] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    paths.add(path);
    collectFieldPaths(subValue, path, paths);
  }
}

test("savegame snapshot field paths match the checked-in list", () => {
  const game = setupFreshTestGame();
  for (let i = 0; i < 120; i++) game.simulation.tick(0.5);
  const snapshot = stripVolatileSnapshotFields(captureSnapshot(game));

  const actual = new Set<string>();
  collectFieldPaths(snapshot, "", actual);

  const expectedUrl = new URL("./savegame-snapshot-paths.json", import.meta.url);
  const expected = new Set<string>(JSON.parse(readFileSync(expectedUrl, "utf-8")) as string[]);

  const added = [...actual].filter((path) => !expected.has(path)).sort();
  const removed = [...expected].filter((path) => !actual.has(path)).sort();

  if (added.length === 0 && removed.length === 0) return;

  const lines = [
    "snapshot field paths drifted — if intentional, regenerate savegame-snapshot-paths.json; if not, check for new runtime fields leaking via spread (see file header):",
    ...added.map((path) => `  + ${path}`),
    ...removed.map((path) => `  - ${path}`),
  ];
  throw new Error(lines.join("\n"));
});
