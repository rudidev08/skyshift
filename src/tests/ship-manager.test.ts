import { test, assertEqual, assertTrue } from "./test-utils.ts";
import { createStation } from "../sim-station.ts";
import type { Ship } from "../sim-ships.ts";
import { ShipManager } from "../sim-ship-manager.ts";
import { NamePool } from "../sim-name-pool.ts";
import { farNation } from "../../data/nations.ts";
import { makePlacedStation } from "./factories.ts";

test("ShipManager.removeShip removes the ship at index 0 (first ship)", () => {
  // Pin the `index < 0` not-found check. A `<= 0` mutation would silently skip
  // removal of the first ship — the head of the roster could never be removed,
  // breaking emigration demolition and decommission for any ship that happens
  // to sit at index 0.
  const manager = new ShipManager(new NamePool());
  const stationA = createStation(
    makePlacedStation({ id: "FAR-A", stationTypeId: "habitat", size: "M", nation: farNation }),
  );
  const stationB = createStation(
    makePlacedStation({ id: "FAR-B", stationTypeId: "habitat", size: "M", nation: farNation }),
  );
  const shipA: Ship = { id: "A-001", shipTypeId: "trader", shipName: "Alpha", station: stationA };
  const shipB: Ship = { id: "B-001", shipTypeId: "trader", shipName: "Bravo", station: stationB };
  manager.addShips([shipA, shipB]);
  assertEqual(manager.getAllShips().length, 2, "two ships seeded");

  manager.removeShip(shipA);

  assertEqual(manager.getAllShips().length, 1, "first ship was removed");
  assertEqual(manager.getShip("A-001"), undefined, "removed ship is no longer in the byId map");
  assertTrue(manager.getShip("B-001") !== undefined, "second ship is still resolvable");
});
