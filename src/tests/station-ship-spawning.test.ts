import { test, assertEqual, assertTrue, assertThrows } from "./test-utils.ts";
import { createStation } from "../sim-station.ts";
import { createStationShips, getNationShipTemplate, type Ship } from "../sim-ships.ts";
import { ShipManager } from "../sim-ship-manager.ts";
import { NamePool } from "../sim-name-pool.ts";
import type { StationSize, StationTypeId } from "../../data/station-types.ts";
import type { Station } from "../sim-station-types.ts";
import { farNation, oreNation, wayNation } from "../../data/nations.ts";
import { makeStationPlacement } from "./factories.ts";

function createFarNationStation(id: string, stationTypeId: StationTypeId, size: StationSize): Station {
  return createStation(makeStationPlacement({ id, stationTypeId, size, nation: farNation }));
}

test("createStationShips skips FAR observatory because traders cannot carry signal", () => {
  const ships = createStationShips({
    station: createFarNationStation("FAR-OBS", "observatory", "M"),
    takenShipIds: new Set<string>(),
    namePool: new NamePool(),
  });
  assertEqual(ships.length, 0, "FAR observatory should not spawn ships");
});

test("createStationShips still spawns FAR habitat ships when traders can move stocked wares", () => {
  // Pin Math.random so the random-attempt branch of generateUniqueShipCode
  // always proposes the same code — that exercises the per-loop reservation:
  // without it, both ships would land on identical ids.
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const ships = createStationShips({
      station: createFarNationStation("FAR-HAB", "habitat", "M"),
      takenShipIds: new Set<string>(),
      namePool: new NamePool(),
    });
    assertEqual(ships.length, 2, "FAR habitat should still spawn its normal ship count");
    const uniqueShipIds = new Set(ships.map((ship) => ship.id));
    assertEqual(uniqueShipIds.size, ships.length, "every spawned ship should have a unique id");
    // Pin the ship-code format `<NATION>-NNN` (3-digit zero-padded). Mutating
    // padStart(3, "0") to padStart(2, "0") would emit "FAR-00" instead of
    // "FAR-000"; the uniqueness assertion above can't see that.
    for (const ship of ships) {
      assertTrue(/^FAR-\d{3}$/.test(ship.id), `ship id ${ship.id} should match FAR-NNN`);
    }
    // Names are claimed without replacement from the nation's pool, so a fleet
    // of two should never share a name.
    const uniqueShipNames = new Set(ships.map((ship) => ship.shipName));
    assertEqual(uniqueShipNames.size, ships.length, "every spawned ship should have a unique name");
  } finally {
    Math.random = originalRandom;
  }
});

test("createStationShips spawns build-site fleet for ORE mine even though tanker→trader override doesn't match operational wares", () => {
  // Without the construction-aware branch in canShipCarryAnyWareThatStationUses,
  // this returns 0 ships: mine produces "mineral" (raw), trader carries none of
  // {mineral, ore-inputs}, so the operational gate rejects the trader override.
  // The fix routes build sites through their build.waresRequired ({provisions,
  // hulls}) — both of which trader carries — so the override actually spawns.
  const station = createStation(makeStationPlacement({
    id: "ORE-MINE-X",
    stationTypeId: "mine",
    size: "M",
    nation: oreNation,
    state: "building",
    build: { waresRequired: { provisions: 4200, hulls: 7800 }, contractingNationId: undefined },
  }));
  const ships = createStationShips({
    station,
    takenShipIds: new Set<string>(),
    namePool: new NamePool(),
    options: { shipTypeOverride: "trader" },
  });
  assertEqual(ships.length, 2, "ORE mine build site should spawn 2 trader build-fleet ships so provisions+hulls can flow");
});

test("createStationShips force-spawns editor fleets even when station wares are incompatible", () => {
  const ships = createStationShips({
    station: createFarNationStation("FAR-OBS", "observatory", "M"),
    takenShipIds: new Set<string>(),
    namePool: new NamePool(),
    options: { ignoreCargoCompatibility: true },
  });
  assertEqual(ships.length, 2, "force-spawned editor fleets should preserve the full station ship count");
});

test("getNationShipTemplate throws for nations with no primary fleet (WAY)", () => {
  // Pin the throw guard on `nation.shipTypeId == null`. Dropping the guard
  // would fall through to getShipTemplate(null) — getShipTemplate's own
  // unknown-id throw fires with a less-specific message, and any caller that
  // checks for the WAY-specific text in the error would silently miss.
  assertThrows(
    () => getNationShipTemplate(wayNation as unknown as Parameters<typeof getNationShipTemplate>[0]),
    "no primary ship type",
    "WAY nation should be rejected with the no-fleet message",
  );
});

test("ShipManager.removeShip removes the ship at index 0 (first ship)", () => {
  // Pin the `index < 0` not-found check. A `<= 0` mutation would silently skip
  // removal of the first ship — the head of the roster could never be removed,
  // breaking emigration demolition and decommission for any ship that happens
  // to sit at index 0.
  const manager = new ShipManager(new NamePool());
  const stationA = createFarNationStation("FAR-A", "habitat", "M");
  const stationB = createFarNationStation("FAR-B", "habitat", "M");
  const shipA: Ship = { id: "A-001", shipTypeId: "trader", shipName: "Alpha", station: stationA };
  const shipB: Ship = { id: "B-001", shipTypeId: "trader", shipName: "Bravo", station: stationB };
  manager.addShips([shipA, shipB]);
  assertEqual(manager.getAllShips().length, 2, "two ships seeded");

  manager.removeShip(shipA);

  assertEqual(manager.getAllShips().length, 1, "first ship was removed");
  assertEqual(manager.getShip("A-001"), undefined, "removed ship is no longer in the byId map");
  assertTrue(manager.getShip("B-001") !== undefined, "second ship is still resolvable");
});
