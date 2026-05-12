import { test, assertEqual, assertNotUndefined } from "./test-utils.ts";
import { findSectorAtPosition, findSectorForStation } from "../sim-sector-lookup.ts";
import { makeSector } from "./factories.ts";
import type { Sector } from "../sim-map-types.ts";

// Pins sim-sector-lookup.ts. findSectorForStation feeds emigration HUD,
// announcements, and station manager. A swapped axis or off-by-one in grid
// math would silently mislabel every "in <sector>" log line and toast.

const SECTOR_SIZE = 1000;

function buildSectors(): Sector[] {
  // Three side-by-side sectors at distinct centers so axis-swap mutations
  // produce a wrong-sector resolution rather than a coincidentally-matching one.
  return [
    makeSector({ id: "alpha", x: 500, y: 500, size: SECTOR_SIZE }),     // covers x ∈ [0,1000], y ∈ [0,1000]
    makeSector({ id: "beta",  x: 1500, y: 500, size: SECTOR_SIZE }),    // covers x ∈ [1000,2000], y ∈ [0,1000]
    makeSector({ id: "gamma", x: 500, y: 1500, size: SECTOR_SIZE }),    // covers x ∈ [0,1000], y ∈ [1000,2000]
  ];
}

test("findSectorAtPosition: returns the sector whose square contains (x, y)", () => {
  const sectors = buildSectors();
  // Center of beta — should resolve to beta unambiguously.
  const sector = assertNotUndefined(findSectorAtPosition(sectors, 1500, 500), "beta center");
  assertEqual(sector.id, "beta", "center of beta resolves to beta");
});

test("findSectorAtPosition: x and y axes are not swapped — beta and gamma are mirror coordinates", () => {
  // beta is at (1500, 500); gamma is at (500, 1500). Pin that swapping the
  // axes mid-comparison routes (1500, 500) to gamma instead of beta.
  const sectors = buildSectors();
  const beta = assertNotUndefined(findSectorAtPosition(sectors, 1500, 500), "x=1500, y=500");
  assertEqual(beta.id, "beta", "x=1500, y=500 resolves to beta (not gamma)");
  const gamma = assertNotUndefined(findSectorAtPosition(sectors, 500, 1500), "x=500, y=1500");
  assertEqual(gamma.id, "gamma", "x=500, y=1500 resolves to gamma (not beta)");
});

test("findSectorAtPosition: closed-interval boundary is inclusive (≤, not <)", () => {
  // A station exactly on alpha's right edge (x = 1000) matches alpha because
  // |1000 - 500| = 500 ≤ half (500). Pin the ≤ comparison — mutating to <
  // would let edge stations fall outside any sector.
  const sectors = buildSectors();
  const sector = assertNotUndefined(findSectorAtPosition(sectors, 1000, 500), "alpha right edge");
  // Iteration order: alpha first, beta second. alpha matches (≤), so alpha wins.
  assertEqual(sector.id, "alpha", "edge inclusive — first matching sector wins");
});

test("findSectorAtPosition: returns undefined when (x, y) is outside every sector", () => {
  // Far off in negative space — no sector covers (−9999, −9999).
  const sectors = buildSectors();
  const sector = findSectorAtPosition(sectors, -9999, -9999);
  assertEqual(sector, undefined, "out-of-range coords return undefined");
});

test("findSectorAtPosition: returns undefined when sectors array is empty", () => {
  // Pin the early-return on sectors.length === 0. Mutating to drop it would
  // try to read sectors[0].size and crash with "Cannot read property 'size' of undefined".
  const sector = findSectorAtPosition([], 500, 500);
  assertEqual(sector, undefined, "empty sectors returns undefined");
});

test("findSectorAtPosition: per-axis check is independent — y-mismatch doesn't get rescued by x-match", () => {
  // alpha at (500, 500), gamma at (500, 1500). x is the same, y differs.
  // (500, 5000) has matching x but y is far out of range. Pin that BOTH
  // axis checks must pass — mutating the && to || would let y-out-of-range
  // stations match because x is fine.
  const sectors = buildSectors();
  const sector = findSectorAtPosition(sectors, 500, 5000);
  assertEqual(sector, undefined, "y-out-of-range with matching x returns undefined");
});

test("findSectorForStation: delegates to findSectorAtPosition with station coords", () => {
  // Sanity-check the wrapper. Pin that the station's x,y goes to position
  // lookup unchanged — a mutation that swapped them inside the wrapper
  // would break every consumer.
  const sectors = buildSectors();
  const map = { sectors };
  const station = { x: 1500, y: 500 };
  const sector = assertNotUndefined(findSectorForStation(map, station), "wrapper resolves");
  assertEqual(sector.id, "beta", "wrapper passes station.x, station.y in correct order");
});

test("findSectorAtPosition: uses sector[0].size as the canonical half-extent — sectors must share size", () => {
  // The function reads `sectors[0].size / 2` once and reuses for every check.
  // Pin: when all sectors share size (the project invariant), lookups succeed.
  // (A mixed-size sector list isn't supported by the function — caller
  // guarantees uniform size in createMapFromTemplate.)
  const sectors = buildSectors();
  // Off-center but well within all 1000-px sectors — should resolve.
  const sector = assertNotUndefined(findSectorAtPosition(sectors, 1499, 999), "near beta corner");
  assertEqual(sector.id, "beta", "lookup uses sectors[0].size/2 as the half-extent");
});

test("findSectorAtPosition: iteration order determines tie-break at boundaries", () => {
  // A station at x = 1000 (on the alpha/beta border) and y = 500 (alpha row)
  // matches both alpha and beta via the closed-interval ≤ check. Pin that
  // iteration order (alpha first) wins. Mutating sectors to put beta first
  // would invert the result.
  const sectors = buildSectors();
  // alpha is sectors[0] in our fixture. So x=1000, y=500 should resolve to alpha.
  assertEqual(findSectorAtPosition(sectors, 1000, 500)?.id, "alpha", "first sector with a match wins");

  // Reorder so beta is first; same coord should now resolve to beta.
  const reordered = [sectors[1], sectors[0], sectors[2]];
  assertEqual(findSectorAtPosition(reordered, 1000, 500)?.id, "beta", "reorder changes tie-break winner");
});

test("findSectorAtPosition: works for sectors at high (large) coordinate values without overflow", () => {
  // Sectors in real map data (settled preset) sit at map coords like (3000, 3000)
  // up to ~12000. Pin that the lookup math holds at those scales — no surprise
  // floating-point loss of precision.
  const sectors: Sector[] = [
    makeSector({ id: "far", x: 12000, y: 8000, size: 1500 }),
  ];
  const sector = assertNotUndefined(findSectorAtPosition(sectors, 12000, 8000), "exact center");
  assertEqual(sector.id, "far", "exact center of high-coord sector resolves");
  // Edge-of-sector at the high end — pin the ≤ check at large values too.
  assertEqual(findSectorAtPosition(sectors, 12750, 8750)?.id, "far", "high-coord sector edge inclusive");
});

test("findSectorAtPosition: a station moving from one sector to another resolves to the new sector each call", () => {
  // No cache to invalidate — the function is stateless. Pin that two
  // consecutive calls with different coords return different sectors.
  // Mutating the function to memoize inadvertently would freeze the result.
  const sectors = buildSectors();
  assertEqual(findSectorAtPosition(sectors, 500, 500)?.id, "alpha", "first call: alpha");
  assertEqual(findSectorAtPosition(sectors, 1500, 500)?.id, "beta", "second call: beta (no stale cache)");
  assertEqual(findSectorAtPosition(sectors, 500, 1500)?.id, "gamma", "third call: gamma");
});
