import { test, assertEqual, assertTrue } from "./test-utils.ts";
import { WareStationIndex } from "../sim-ware-station-index.ts";
import { createInventorySlot } from "../sim-station.ts";
import { getWareTemplate } from "../sim-ware-template.ts";
import { makeStation } from "./factories.ts";
import type { Station } from "../sim-station-types.ts";
import type { WareId } from "../../data/ware-types.ts";

// Pins WareStationIndex rebuild correctness. This index drives every trade
// decision; quietly going stale would silently misroute trades.

function slotFor(wareId: WareId): ReturnType<typeof createInventorySlot> {
  return createInventorySlot(getWareTemplate(wareId), 0, 100);
}

function metalForge(idSuffix = ""): Station {
  // metal-forge produces metal, consumes mineral.
  return makeStation({
    placement: { id: `ORE-F${idSuffix}`, stationTypeId: "metal-forge" },
    produces: ["metal"],
    inventory: [slotFor("metal"), slotFor("mineral")],
  });
}

function mine(idSuffix = ""): Station {
  // mine produces ice and mineral, consumes nothing — multi-output producer.
  return makeStation({
    placement: { id: `ORE-M${idSuffix}`, stationTypeId: "mine" },
    produces: ["ice", "mineral"],
    inventory: [slotFor("ice"), slotFor("mineral")],
  });
}

function medicalLab(idSuffix = ""): Station {
  // medical-lab produces medicine, consumes mineral and food — multi-input consumer.
  return makeStation({
    placement: { id: `BIO-L${idSuffix}`, stationTypeId: "medical-lab" },
    produces: ["medicine"],
    inventory: [slotFor("medicine"), slotFor("mineral"), slotFor("food")],
  });
}

test("rebuild: producers populated from station's produces list", () => {
  const station = metalForge();
  const index = new WareStationIndex();
  index.rebuild([station]);

  const metalProducers = index.getProducers("metal");
  assertEqual(metalProducers.length, 1, "metal has exactly one producer");
  assertEqual(metalProducers[0], station, "metal producer is the metal-forge");

  // Pin the produces-list lookup. Mutating `produces.includes(...)` to its
  // negation would route the metal slot into consumers and leave producers empty.
  assertEqual(index.getProducers("mineral").length, 0, "mineral has no producer (only an input slot here)");
});

test("rebuild: multi-ware producer appears under every produced ware", () => {
  // mine produces both ice and mineral — pin that the loop hits each slot, not
  // just the first. Mutating `for (const slot of …)` to `array[0]` would only
  // index ice (or only mineral, depending on slot order).
  const station = mine();
  const index = new WareStationIndex();
  index.rebuild([station]);

  assertEqual(index.getProducers("ice").length, 1, "ice has the mine as a producer");
  assertEqual(index.getProducers("ice")[0], station, "ice producer identity");
  assertEqual(index.getProducers("mineral").length, 1, "mineral has the mine as a producer");
  assertEqual(index.getProducers("mineral")[0], station, "mineral producer identity");
});

test("rebuild: consumers populated from non-produced inventory slots on producing stations", () => {
  const station = metalForge();
  const index = new WareStationIndex();
  index.rebuild([station]);

  // mineral is an input-only slot on metal-forge — it's consumed, not produced.
  const mineralConsumers = index.getConsumers("mineral");
  assertEqual(mineralConsumers.length, 1, "mineral has exactly one consumer");
  assertEqual(mineralConsumers[0], station, "mineral consumer identity");
  // The produced ware (metal) must NOT appear in the consumer index for a
  // producing station — that's the producer/consumer split this test pins.
  assertEqual(index.getConsumers("metal").length, 0, "produced ware slot does not appear in consumers");
});

test("rebuild: multi-input consumer appears under every input ware", () => {
  // medical-lab consumes both mineral and food — pin that each input slot is
  // routed independently to the consumer index.
  const station = medicalLab();
  const index = new WareStationIndex();
  index.rebuild([station]);

  assertEqual(index.getConsumers("mineral")[0], station, "mineral consumer identity");
  assertEqual(index.getConsumers("food")[0], station, "food consumer identity");
  assertEqual(index.getProducers("medicine")[0], station, "medicine producer identity");
});

test("rebuild: under-construction stations are consumer-only across all slots", () => {
  // A building station's inventory carries only provisions/hulls slots, but
  // the rule is "isOutputSlot is false for every slot when isUnderConstruction"
  // — pin it with a station whose inventory includes a would-be producer slot
  // (metal) that must still land in consumers while state === "building".
  const station = makeStation({
    placement: {
      id: "ORE-F",
      stationTypeId: "metal-forge",
      state: "building",
      build: { waresRequired: { provisions: 100, hulls: 100 } },
    },
    produces: ["metal"],
    inventory: [slotFor("metal"), slotFor("mineral")],
  });
  const index = new WareStationIndex();
  index.rebuild([station]);

  // Pin the construction guard. Mutating `!isUnderConstruction && produces.includes(...)`
  // by dropping `!isUnderConstruction` would route metal into producers
  // (the contract says construction is inbound-only).
  assertEqual(index.getProducers("metal").length, 0, "building station does not appear in producers");
  assertEqual(index.getConsumers("metal").length, 1, "building station's would-be output slot is consumer-only");
  assertEqual(index.getConsumers("mineral").length, 1, "building station's input slot is also a consumer");
});

test("rebuild: claimed-state stations are excluded from both indices", () => {
  // canStationTrade returns false for `claimed` — pin that the early-continue
  // skips them. Mutating the guard would leak claimed stations into the index.
  const station = makeStation({
    placement: { id: "ORE-C", stationTypeId: "metal-forge", state: "claimed" },
    produces: ["metal"],
    inventory: [slotFor("metal"), slotFor("mineral")],
  });
  const index = new WareStationIndex();
  index.rebuild([station]);

  assertEqual(index.getProducers("metal").length, 0, "claimed station not in producers");
  assertEqual(index.getConsumers("mineral").length, 0, "claimed station not in consumers");
});

test("rebuild: emigrating-state stations are excluded from both indices", () => {
  // canStationTrade returns false for `emigrating` too — trade is suspended
  // during the gathering window.
  const station = makeStation({
    placement: { id: "ORE-E", stationTypeId: "metal-forge", state: "emigrating" },
    produces: ["metal"],
    inventory: [slotFor("metal"), slotFor("mineral")],
  });
  const index = new WareStationIndex();
  index.rebuild([station]);

  assertEqual(index.getProducers("metal").length, 0, "emigrating station not in producers");
  assertEqual(index.getConsumers("mineral").length, 0, "emigrating station not in consumers");
});

test("rebuild swap is atomic — no partial-build state visible after the call", () => {
  // The local `producers`/`consumers` maps build up before the assignment.
  // Pin that re-rebuild fully replaces both indices: if the swap were dropped
  // (e.g. `this.producersByWare = producers` removed), getProducers would
  // still return data from the first rebuild after the second.
  const stationA = metalForge("a");
  const index = new WareStationIndex();
  index.rebuild([stationA]);
  assertEqual(index.getProducers("metal")[0], stationA, "first rebuild visible");

  const stationB = metalForge("b");
  index.rebuild([stationB]);
  assertEqual(index.getProducers("metal").length, 1, "second rebuild fully replaces");
  assertEqual(index.getProducers("metal")[0], stationB, "second rebuild swaps maps in place");
});

test("getProducers returns the same shared empty array per miss (no per-call allocation)", () => {
  const index = new WareStationIndex();
  index.rebuild([]);
  // Pin the EMPTY_STATION_LIST sentinel. Mutating the `?? EMPTY_STATION_LIST`
  // to `?? []` would allocate a fresh array every call — these two would
  // become distinct objects.
  const first = index.getProducers("metal");
  const second = index.getProducers("ice");
  assertEqual(first, second, "two miss-path returns are reference-identical");
  assertEqual(first.length, 0, "miss-path return is an empty array");
});

test("getConsumers returns the same shared empty array per miss (no per-call allocation)", () => {
  const index = new WareStationIndex();
  index.rebuild([]);
  const first = index.getConsumers("metal");
  const second = index.getConsumers("ice");
  assertEqual(first, second, "two miss-path returns are reference-identical");
  assertEqual(first.length, 0, "miss-path return is an empty array");
});

test("producersByWareEntries skips wares with zero producers", () => {
  // Mine produces ice and mineral — only those wares should appear in entries().
  // metal (consumed by tech-factory etc.) shouldn't show up.
  const index = new WareStationIndex();
  index.rebuild([mine()]);
  const wareIdsInEntries = new Set<WareId>();
  for (const [wareId] of index.producersByWareEntries()) wareIdsInEntries.add(wareId);

  assertEqual(wareIdsInEntries.size, 2, "exactly two wares have producers");
  assertTrue(wareIdsInEntries.has("ice"), "ice has producer entry");
  assertTrue(wareIdsInEntries.has("mineral"), "mineral has producer entry");
  assertTrue(!wareIdsInEntries.has("metal"), "metal is absent (no producer)");
});

test("rebuild after station removal drops it from both producer and consumer indices", () => {
  // Rebuild is from-scratch — pin that a removed station leaves no trace, even
  // though the index instance is reused.
  const station = medicalLab();
  const index = new WareStationIndex();
  index.rebuild([station]);
  assertEqual(index.getProducers("medicine").length, 1, "medicine has a producer before removal");
  assertEqual(index.getConsumers("food").length, 1, "food has a consumer before removal");

  index.rebuild([]);
  assertEqual(index.getProducers("medicine").length, 0, "medicine producer dropped after removal");
  assertEqual(index.getConsumers("food").length, 0, "food consumer dropped after removal");
});

test("rebuild after building→producing flip moves output slots from consumer to producer", () => {
  // Simulate the lifecycle flip: same station instance rebuilt twice — first
  // while state="building" (output slot lands in consumers), then while
  // state="producing" (output slot lands in producers).
  const station = makeStation({
    placement: {
      id: "ORE-F",
      stationTypeId: "metal-forge",
      state: "building",
      build: { waresRequired: { provisions: 100, hulls: 100 } },
    },
    produces: ["metal"],
    inventory: [slotFor("metal"), slotFor("mineral")],
  });
  const index = new WareStationIndex();
  index.rebuild([station]);

  // While building: metal slot is a consumer (construction is inbound-only).
  assertEqual(index.getProducers("metal").length, 0, "building: metal not in producers");
  assertEqual(index.getConsumers("metal")[0], station, "building: metal slot is a consumer");

  // Flip to producing and rebuild — output slot moves to producers.
  station.state = "producing";
  station.build = undefined;
  index.rebuild([station]);

  // Pin the lifecycle flip. Mutating the state check inside isStationUnderConstruction
  // would either trap output slots in consumers forever or skip the consumer
  // routing entirely.
  assertEqual(index.getProducers("metal")[0], station, "producing: metal slot promoted to producer");
  assertEqual(index.getConsumers("metal").length, 0, "producing: metal slot removed from consumers");
  assertEqual(index.getConsumers("mineral")[0], station, "producing: mineral input still a consumer");
});

test("rebuild on empty roster produces empty indices and entries iterator", () => {
  // Boundary — pin that calling rebuild with no stations leaves both maps
  // empty rather than carrying state from a prior rebuild or default-constructed map.
  const index = new WareStationIndex();
  index.rebuild([metalForge()]);
  assertEqual(index.getProducers("metal").length, 1, "preconditions: metal-forge present");

  index.rebuild([]);
  assertEqual(index.getProducers("metal").length, 0, "empty roster clears producers");
  assertEqual(index.getConsumers("mineral").length, 0, "empty roster clears consumers");
  let entryCount = 0;
  for (const _ of index.producersByWareEntries()) entryCount++;
  assertEqual(entryCount, 0, "empty roster produces no entries");
});
