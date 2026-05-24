import { test, assertEqual, assertTrue, withScriptedMathRandom } from "./test-utils.ts";
import { createStation } from "../sim-station.ts";
import { createStationShips } from "../sim-ships.ts";
import { getShipTypeTemplate } from "../sim-ship-template.ts";
import { NamePool } from "../sim-name-pool.ts";
import type { StationSize, StationTypeId } from "../../data/station-types.ts";
import type { Station } from "../sim-station-types.ts";
import { bioNation, farNation, oreNation, skyNation, wayNation } from "../../data/nations.ts";
import { makePlacedStation } from "./factories.ts";

function createFarNationStation(id: string, stationTypeId: StationTypeId, size: StationSize): Station {
  return createStation(makePlacedStation({ id, stationTypeId, size, nation: farNation }));
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
  withScriptedMathRandom([0], () => {
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
    // Pin without-replacement on the draw pile (FAR has 20 ship names; a
    // 2-ship fleet draws far below exhaustion, so no name should need a
    // suffix). If drawFromPool peeked instead of popping (`remaining.pop()`
    // → `remaining[...]`), both ships would draw the same base name and
    // claimName would mask it as "Traverse" + "Traverse Primus" — distinct
    // strings, so the size check above stays green while without-replacement
    // is broken. A suffixed reuse is exactly "<earlier name> <suffix>", so
    // assert no spawned name is another spawned name plus a trailing word.
    for (const ship of ships) {
      for (const other of ships) {
        if (other === ship) continue;
        assertTrue(
          !ship.shipName.startsWith(`${other.shipName} `),
          `ship name "${ship.shipName}" is a suffixed reuse of "${other.shipName}" — pool drew the same base name twice`,
        );
      }
    }
  });
});

test("createStationShips avoids ids already in takenShipIds (cross-station collisions)", () => {
  // Pre-fill `occupied` with the first station's ids. Without them (`new Set<string>()`),
  // the second station's spawn loop would propose "FAR-000" every attempt
  // (Math.random=0) and pass the collision check, defeating the cross-station guard.
  withScriptedMathRandom([0], () => {
    const occupied = new Set<string>(["FAR-000", "FAR-001"]);
    const ships = createStationShips({
      station: createFarNationStation("FAR-HAB-2", "habitat", "M"),
      takenShipIds: occupied,
      namePool: new NamePool(),
    });
    assertEqual(ships.length, 2, "spawns full fleet");
    for (const ship of ships) {
      assertTrue(!occupied.has(ship.id), `spawned id ${ship.id} should not collide with takenShipIds`);
    }
    const uniqueIds = new Set(ships.map((ship) => ship.id));
    assertEqual(uniqueIds.size, ships.length, "spawned fleet has internally-unique ids");
  });
});

test("createStationShips spawns build-site fleet for ORE mine even though tanker→trader override doesn't match operational wares", () => {
  // Without the construction-aware branch in canShipCarryAnyWareThatStationUses,
  // this returns 0 ships: mine produces "mineral" (raw), trader carries none of
  // {mineral, ore-inputs}, so the operational gate rejects the trader override.
  // The fix routes build sites through their build.waresRequired ({provisions,
  // hulls}) — both of which trader carries — so the override actually spawns.
  const station = createStation(
    makePlacedStation({
      id: "ORE-MINE-X",
      stationTypeId: "mine",
      size: "M",
      nation: oreNation,
      state: "building",
      build: { waresRequired: { provisions: 4200, hulls: 7800 }, contractingNationId: undefined },
    }),
  );
  const ships = createStationShips({
    station,
    takenShipIds: new Set<string>(),
    namePool: new NamePool(),
    options: { shipTypeOverride: "trader" },
  });
  assertEqual(
    ships.length,
    2,
    "ORE mine build site should spawn 2 trader build-fleet ships so provisions+hulls can flow",
  );
  // Pin override-takes-priority over nation default. Swapping the `??` operands
  // (`station.nation.shipTypeId ?? options?.shipTypeOverride`) would silently
  // spawn ORE's default tanker — same count, wrong type — and tankers don't
  // carry provisions so the build-site cargo would never flow.
  for (const ship of ships) {
    assertEqual(ship.shipTypeId, "trader", "every spawned ship honors shipTypeOverride");
  }
});

test("createStationShips spawns ships when ship can carry only the produced OUTPUT (no input overlap)", () => {
  // Pin the `productionOutput > 0 && allowedWares.has(producedWareId)` output
  // check in canShipCarryAnyOperationalWare. Most stations have inputs the
  // ship also carries, so the input-side fallback masks a `>0` flip. This
  // test isolates the OUTPUT path: SKY's jumpship carries [signal, hyperdata];
  // observatory produces signal (no inputs). Only the output branch can
  // resolve true here — flipping the comparison to `< 0` would drop ship
  // count to 0.
  const skyObservatory = createStation(
    makePlacedStation({
      id: "SKY-OBS",
      stationTypeId: "observatory",
      size: "M",
      nation: skyNation,
    }),
  );
  const ships = createStationShips({
    station: skyObservatory,
    takenShipIds: new Set<string>(),
    namePool: new NamePool(),
  });
  assertEqual(
    ships.length,
    2,
    "SKY observatory should spawn 2 jumpships — signal output matches allowedWares",
  );
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

test("createStationShips spawns zero ships for a WAY station (no primary fleet)", () => {
  // WAY has shipTypeId: null and stationConstructionShipTypeId: null, so the
  // ship-type resolution yields no type and createStationShips returns []. This
  // is what actually holds — a Ship only exists when a non-null shipTypeId
  // resolved, which is why the render path can read ship.shipTypeId directly
  // (the removed getNationShipTypeTemplate's WAY throw was unreachable from any
  // render call path: no WAY ship is ever constructed).
  const station = createStation(
    makePlacedStation({ id: "WAY-GEN", stationTypeId: "habitat", size: "M", nation: wayNation }),
  );
  const ships = createStationShips({
    station,
    takenShipIds: new Set<string>(),
    namePool: new NamePool(),
  });
  assertEqual(ships.length, 0, "WAY station spawns no ships");
});

test("build-site override fleet renders its own ship type, not the nation default", () => {
  // BIO's primary fleet is seedhaul, but its stationConstructionShipTypeId is
  // trader — so a BIO build-site fleet spawned with shipTypeOverride:"trader"
  // gets ship.shipTypeId === "trader". The render path resolves the ship type
  // from the ship's OWN shipTypeId. Under the OLD getNationShipTypeTemplate
  // path it re-derived from station.nation.shipTypeId ("seedhaul") and painted
  // override fleets with the wrong texture/HUD-icon/name/lore — this test
  // fails under that path (resolved id would be "seedhaul").
  const station = createStation(
    makePlacedStation({
      id: "BIO-FARM-X",
      stationTypeId: "farm",
      size: "M",
      nation: bioNation,
      state: "building",
      build: { waresRequired: { provisions: 4200, hulls: 7800 }, contractingNationId: undefined },
    }),
  );
  const ships = createStationShips({
    station,
    takenShipIds: new Set<string>(),
    namePool: new NamePool(),
    options: { shipTypeOverride: "trader" },
  });
  assertTrue(ships.length > 0, "BIO build site spawns at least one trader build-fleet ship");
  for (const ship of ships) {
    assertEqual(ship.shipTypeId, "trader", "spawned ship carries the override shipTypeId");
    // The render resolution: getShipTypeTemplate(ship.shipTypeId). Must be the
    // trader template, NOT bioNation.shipTypeId's seedhaul template.
    const resolved = getShipTypeTemplate(ship.shipTypeId);
    assertEqual(
      resolved.id,
      "trader",
      "render resolves the ship's own type (trader), not the nation default (seedhaul)",
    );
  }
});
