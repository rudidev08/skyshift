import { test, assertEqual, assertTrue, assertThrows } from "./test-utils.ts";
import { createStationZones } from "../sim-station-zone.ts";
import { stationBuilderNations } from "../../data/nations.ts";
import type { StationZoneTemplate } from "../../data/station-zone-types.ts";
import { makeSector } from "./factories.ts";

function miniSectors() {
  return [makeSector({ id: "alpha", name: "Alpha" })];
}

test("createStationZones resolves a zone's sector from its position", () => {
  // alpha's square is center (0,0) size 1000 → x,y ∈ [-500,500]; beta is the
  // neighbour. The zone at (0,0) must resolve to alpha because that's the
  // sector its position falls in — there is no stored sectorId to fall back on.
  const sectors = [
    makeSector({ id: "alpha", name: "Alpha", x: 0, y: 0, size: 1000 }),
    makeSector({ id: "beta", name: "Beta", x: 1000, y: 0, size: 1000 }),
  ];
  const zones: StationZoneTemplate[] = [{ id: "alpha-1", x: 0, y: 0, size: "L" }];
  const built = createStationZones(zones, sectors);
  assertEqual(built[0].sector.id, "alpha", "sector resolved from position (0,0)");
});

test("createStationZones throws when a zone's position is outside every sector", () => {
  const sectors = [makeSector({ id: "alpha", name: "Alpha", x: 0, y: 0, size: 1000 })];
  const zones: StationZoneTemplate[] = [{ id: "alpha-1", x: 99999, y: 99999, size: "M" }];
  assertThrows(
    () => createStationZones(zones, sectors),
    "alpha-1",
    "a zone outside every sector should name the offending zone",
  );
});

test("createStationZones throws when the zone's position resolves to a sector its id prefix doesn't name", () => {
  // Position (0,0) resolves to alpha, but the zone id "beta-1" claims sector
  // beta. The seed-time check must reject a zone whose coords drifted out of
  // the sector its id names.
  const sectors = [
    makeSector({ id: "alpha", name: "Alpha", x: 0, y: 0, size: 1000 }),
    makeSector({ id: "beta", name: "Beta", x: 1000, y: 0, size: 1000 }),
  ];
  const zones: StationZoneTemplate[] = [{ id: "beta-1", x: 0, y: 0, size: "M" }];
  assertThrows(
    () => createStationZones(zones, sectors),
    "beta-1",
    "an id-prefix/position mismatch should name the offending zone",
  );
});

test("createStationZones resolves the sector and flattens template fields", () => {
  const zones: StationZoneTemplate[] = [{ id: "alpha-1", x: 100, y: 200, size: "L" }];
  const built = createStationZones(zones, miniSectors());
  assertEqual(built.length, 1, "one zone built");
  const zone = built[0];
  assertTrue(zone.id === "alpha-1", `id flattened, got ${zone.id}`);
  assertEqual(zone.x, 100, "x flattened");
  assertEqual(zone.y, 200, "y flattened");
  assertTrue(zone.size === "L", `size flattened, got ${zone.size}`);
  assertTrue(zone.sector.id === "alpha", `sector resolved, got ${zone.sector.id}`);
  assertTrue(zone.sector.name === "Alpha", `sector name reachable, got ${zone.sector.name}`);
  // Pin the code shape: NIL- + one digit + one uppercase letter (e.g. "NIL-3A").
  // Without this, mutations to the digit range (`* 10` → `* 1`), the letter
  // base (`65` → `64`, allowing `@`), or always falling through to the base36
  // fallback go undetected.
  assertTrue(/^NIL-[0-9][A-Z]$/.test(zone.code), `code shape NIL-<digit><A-Z>, got ${zone.code}`);
  // Pin the user-facing "Unclaimed" prefix. The HUD's "Zones" view mode shows
  // unoccupied zones with this prefix to communicate buildable/unowned status;
  // changing the literal silently breaks that copy.
  assertTrue(zone.name.startsWith("Unclaimed "), `name should start with "Unclaimed ", got ${zone.name}`);
});

test("createStationZones wraps nation assignment past stationBuilderNations.length", () => {
  // Pin the `index % stationBuilderNations.length` modulo. Drop the modulo (bare
  // `index`) and the stationBuilderNations[N] read returns undefined → throws.
  // Count is also large enough to exceed each building nation's nameSuffixes
  // pool — pins the suffix-side modulo too.
  const zoneCount = 60;
  const zones: StationZoneTemplate[] = Array.from({ length: zoneCount }, (_, i) => ({
    id: `alpha-${i}`,
    x: i,
    y: 0,
    size: "M",
  }));

  const built = createStationZones(zones, miniSectors());

  assertEqual(built.length, zoneCount, "all zones built");
  // Every zone's name must include the sector name; a crash from undefined
  // nation would have thrown before this line.
  for (let index = 0; index < built.length; index++) {
    const zone = built[index];
    assertTrue(zone.name.includes("Alpha"), `zone name should include sector, got ${zone.name}`);
    // Pin code shape across many zones — narrowing the digit range
    // (`* 10` → `* 1`) or the letter base (`65` → `64`) shows up here when
    // the primary loop exhausts and the base36 fallback fires.
    assertTrue(/^NIL-[0-9][A-Z]$/.test(zone.code), `code shape, got ${zone.code}`);
    // Pin nameSuffix is sourced from the assigned (wrapped) nation's pool.
    // Dropping the `index % nameSuffixes.length` modulo would make later
    // indices fall through to `String(index + 1)`, which is not in the pool.
    const nation = stationBuilderNations[index % stationBuilderNations.length];
    assertTrue(
      nation.nameSuffixes.includes(zone.nameSuffix),
      `nameSuffix "${zone.nameSuffix}" should be from ${nation.codeName}'s pool`,
    );
    // Pin nameSuffix appears at the end of the display name (and matches the
    // stored field). Emptying the `nameSuffix` field on the runtime zone, or
    // dropping it from the name template, would fail this.
    assertTrue(
      zone.name.endsWith(` ${zone.nameSuffix}`),
      `zone name should end with " ${zone.nameSuffix}", got ${zone.name}`,
    );
  }
});

test("createStationZones generates unique codes across many zones", () => {
  // The takenCodes set tracks already-issued codes so two zones can't share
  // one. Skipping `takenCodes.add(code)` in generateUniqueZoneCode would let
  // the same NIL-XY string come out twice.
  const zoneCount = 80;
  const zones: StationZoneTemplate[] = Array.from({ length: zoneCount }, (_, i) => ({
    id: `alpha-${i}`,
    x: i,
    y: 0,
    size: "S",
  }));

  const built = createStationZones(zones, miniSectors());

  const codes = new Set<string>();
  for (const zone of built) codes.add(zone.code);
  assertEqual(codes.size, zoneCount, "every zone got a unique code");
});
