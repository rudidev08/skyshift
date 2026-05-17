import type { StationBuild, PlacedStation, StationTypeTemplate } from "../data/station-types";
import type {
  Station,
  InventorySlot,
  StationRates,
  StationEmigration,
  StationGenerationalShipBuild,
} from "./sim-station-types";
import type { WareTemplate, WareId } from "../data/ware-types";
import type {
  StationSnapshot,
  StationBuildSnapshot,
  InventorySlotSnapshot,
  StationEmigrationSnapshot,
  StationGenerationalShipBuildSnapshot,
} from "./sim-save-types";
import { shortNameBySize, sizeMultiplierBySize } from "../data/stations";
import { getStationTypeTemplate } from "./sim-station-template";
import { getWareTemplate, getWareOutputStorage, getWareInputStorage, sortWares } from "./sim-ware-template";
import { getNationById } from "./sim-nation";

export type { InventorySlot, Station };

/** Shared final step of `createStation`, `stationFromSnapshot`, and the
 *  station-manager rebuild path — keeps the inventoryByWareId index, sizeMultiplier,
 *  and default typeAndSizeLabel logic in one place. */
export function assembleStation(
  placement: PlacedStation,
  stationType: StationTypeTemplate,
  inventory: InventorySlot[],
  typeAndSizeLabel?: string,
): Station {
  const size = placement.size;
  const inventoryByWareId = new Map<WareId, InventorySlot>();
  for (const slot of inventory) inventoryByWareId.set(slot.ware.id, slot);
  return {
    id: placement.id,
    name: placement.name ?? placement.id,
    x: placement.x,
    y: placement.y,
    nation: placement.nation,
    size,
    state: placement.state ?? "producing",
    build: placement.build,
    zoneId: placement.zoneId,
    stationType,
    sizeMultiplier: sizeMultiplierBySize[size],
    inventory,
    inventoryByWareId,
    secondsSinceLastTick: 0,
    didProduceLastTick: false,
    typeAndSizeLabel:
      typeAndSizeLabel ?? `${shortNameBySize[size]} ${placement.nation.codeName} ${stationType.name}`,
    emigrationEvent: null,
    generationalShipBuild: null,
  };
}

/** True once the station is online and producing its ware. UI signals and rate
 *  math gate off this — `building` and `emigrating` both return false. */
export function isStationProducing(station: Station): boolean {
  return station.state === "producing";
}

/** Build site receiving inbound construction wares. Distinct from "producing":
 *  this station is the one being built, not the one supplying parts. The
 *  type predicate narrows `station.build` to non-undefined — `build` is
 *  documented "Present iff state === 'building'". */
export function isStationUnderConstruction(station: Station): station is Station & { build: StationBuild } {
  return station.state === "building";
}

/** Can the station participate in trade? True for `producing` (output trade)
 *  and `building` (inbound construction wares); false for `emigrating`
 *  (suspended during gathering window). */
export function canStationTrade(station: Station): boolean {
  return station.state === "producing" || station.state === "building";
}

export function scaleByStationSize(baseRate: number, station: Station): number {
  return baseRate * station.sizeMultiplier;
}

export function getStationRates(station: Station): StationRates {
  const production = new Map<WareId, number>();
  const consumption = new Map<WareId, number>();

  for (const wareId of station.stationType.produces) {
    const ware = getWareTemplate(wareId);
    // Sink wares (output 0) only consume inputs — they don't count as production.
    if (ware.productionOutput > 0) {
      production.set(
        wareId,
        (production.get(wareId) ?? 0) + scaleByStationSize(ware.productionOutput, station),
      );
    }
    for (const input of ware.productionInputs) {
      consumption.set(
        input.wareId,
        (consumption.get(input.wareId) ?? 0) + scaleByStationSize(input.unitsPerTick, station),
      );
    }
  }

  return { production, consumption };
}

export function createInventorySlot(ware: WareTemplate, current: number, max: number): InventorySlot {
  return { ware, current, max, reservedIncoming: 0, reservedOutgoing: 0 };
}

// Encapsulation boundary for Station inventory. Callers resolve slots through
// these; per-slot field mutation via the returned reference is still allowed.

/** Resolve a slot by ware id; undefined if the station doesn't carry it. */
export function getInventorySlot(station: Station, wareId: WareId): InventorySlot | undefined {
  return station.inventoryByWareId.get(wareId);
}

/** All slots in the station type's defined sort order. Array is readonly to deter
 *  reordering / splicing; per-slot fields can still be mutated. */
export function getAllInventorySlots(station: Station): readonly InventorySlot[] {
  return station.inventory;
}

/** Increment reservedIncoming. Throws if the station has no slot — callers
 *  that may race with slot removal should pre-check with `getInventorySlot`. */
export function reserveIncoming(station: Station, wareId: WareId, amount: number): void {
  const slot = station.inventoryByWareId.get(wareId);
  if (!slot) throw new Error(`reserveIncoming: station ${station.id} has no slot for ${wareId}`);
  slot.reservedIncoming += amount;
}

/** Decrement reservedIncoming, clamped to zero. Does nothing on missing slot —
 *  a trade ship may be releasing against a slot whose station was demolished. */
export function releaseIncoming(station: Station, wareId: WareId, amount: number): void {
  const slot = station.inventoryByWareId.get(wareId);
  if (!slot) return;
  slot.reservedIncoming = Math.max(0, slot.reservedIncoming - amount);
}

export function reserveOutgoing(station: Station, wareId: WareId, amount: number): void {
  const slot = station.inventoryByWareId.get(wareId);
  if (!slot) throw new Error(`reserveOutgoing: station ${station.id} has no slot for ${wareId}`);
  slot.reservedOutgoing += amount;
}

export function releaseOutgoing(station: Station, wareId: WareId, amount: number): void {
  const slot = station.inventoryByWareId.get(wareId);
  if (!slot) return;
  slot.reservedOutgoing = Math.max(0, slot.reservedOutgoing - amount);
}

/** Replace inventory wholesale and rebuild the index. Used by the
 *  building→producing flip when swapping in the canonical inventory. */
export function replaceStationInventoryAndIndex(station: Station, inventory: InventorySlot[]): void {
  station.inventory = inventory;
  const byWareId = new Map<WareId, InventorySlot>();
  for (const slot of inventory) byWareId.set(slot.ware.id, slot);
  station.inventoryByWareId = byWareId;
}

/** Append the production-output slot for `ware` unless it's a sink-with-inputs
 *  (output 0 with input recipe — inputs-only, no output buffer). */
function pushOutputSlotIfProducing(
  inventory: InventorySlot[],
  ware: WareTemplate,
  sizeMultiplier: number,
  starterFillRatio: number,
): void {
  const inputs = ware.productionInputs;
  const isSinkWithInputs = ware.productionOutput === 0 && inputs.length > 0;
  if (isSinkWithInputs) return;
  const max = Math.floor(getWareOutputStorage(ware) * sizeMultiplier);
  inventory.push(createInventorySlot(ware, Math.floor(max * starterFillRatio), max));
}

/** Append one input slot per ingredient on `ware.productionInputs`. */
function pushInputSlots(
  inventory: InventorySlot[],
  ware: WareTemplate,
  sizeMultiplier: number,
  starterFillRatio: number,
): void {
  for (const input of ware.productionInputs) {
    const inputWare = getWareTemplate(input.wareId);
    const inputMax = Math.floor(getWareInputStorage(input) * sizeMultiplier);
    inventory.push(createInventorySlot(inputWare, Math.floor(inputMax * starterFillRatio), inputMax));
  }
}

/** Create a full runtime `Station` from a `PlacedStation`. */
export function createStation(placement: PlacedStation, starterFillRatio: number = 0.5): Station {
  const stationType = getStationTypeTemplate(placement.stationTypeId);
  const sizeMultiplier = sizeMultiplierBySize[placement.size];

  const inventory: InventorySlot[] = [];
  for (const wareId of stationType.produces) {
    const ware = getWareTemplate(wareId);
    pushOutputSlotIfProducing(inventory, ware, sizeMultiplier, starterFillRatio);
    pushInputSlots(inventory, ware, sizeMultiplier, starterFillRatio);
  }

  // Match canonical `allWares` order so display sites don't need to re-sort.
  inventory.sort((leftSlot, rightSlot) => sortWares(leftSlot.ware, rightSlot.ware));

  return assembleStation(placement, stationType, inventory);
}

function stationBuildToSnapshot(build: StationBuild): StationBuildSnapshot {
  return {
    waresRequired: { ...build.waresRequired },
    contractingNationId: build.contractingNationId,
  };
}

/** Serialize a station to its snapshot form. Inventory order is preserved. */
export function stationToSnapshot(station: Station): StationSnapshot {
  return {
    id: station.id,
    nationId: station.nation.id,
    typeId: station.stationType.id,
    size: station.size,
    name: station.name,
    x: station.x,
    y: station.y,
    zoneId: station.zoneId,
    state: station.state,
    build: station.build ? stationBuildToSnapshot(station.build) : undefined,
    inventory: station.inventory.map(slotToSnapshot),
    ...(station.emigrationEvent && {
      emigrationEvent: emigrationToSnapshot(station.emigrationEvent),
    }),
    ...(station.generationalShipBuild && {
      generationalShipBuild: generationalShipBuildToSnapshot(station.generationalShipBuild),
    }),
  };
}

function emigrationToSnapshot(emigration: StationEmigration): StationEmigrationSnapshot {
  return {
    eventId: emigration.eventId,
    destinationName: emigration.destinationName,
    initialHomedShipIds: [...emigration.initialHomedShipIds],
    totalEmigrants: emigration.totalEmigrants,
    launched: emigration.launched,
    secondsUntilNextLaunch: emigration.secondsUntilNextLaunch,
  };
}

function emigrationFromSnapshot(snapshot: StationEmigrationSnapshot): StationEmigration {
  const initialHomedShipIds = [...snapshot.initialHomedShipIds];
  return {
    eventId: snapshot.eventId,
    destinationName: snapshot.destinationName,
    initialHomedShipIds,
    initialHomedShipIdSet: new Set(initialHomedShipIds),
    totalEmigrants: snapshot.totalEmigrants,
    launched: snapshot.launched,
    secondsUntilNextLaunch: snapshot.secondsUntilNextLaunch,
    // Derived — emigration manager refreshes on first post-load tick.
    progressFraction: 0,
  };
}

function generationalShipBuildToSnapshot(
  build: StationGenerationalShipBuild,
): StationGenerationalShipBuildSnapshot {
  return {
    eventId: build.eventId,
    destinationName: build.destinationName,
    emigratingStationCount: build.emigratingStationCount,
  };
}

function generationalShipBuildFromSnapshot(
  snapshot: StationGenerationalShipBuildSnapshot,
): StationGenerationalShipBuild {
  return {
    eventId: snapshot.eventId,
    destinationName: snapshot.destinationName,
    emigratingStationCount: snapshot.emigratingStationCount,
    // Derived — emigration manager refreshes on first post-load tick.
    arrivalFraction: 0,
  };
}

function slotToSnapshot(slot: InventorySlot): InventorySlotSnapshot {
  return {
    wareId: slot.ware.id,
    current: slot.current,
    reservedIncoming: slot.reservedIncoming,
    reservedOutgoing: slot.reservedOutgoing,
  };
}

/** Restore a station whose state === "building": inventory slots come from
 *  `snapshot.build.waresRequired` (the contracted delivery target), not from the
 *  station-type recipe — only provisions/hulls slots exist while construction
 *  is in flight. */
function stationFromBuildingSnapshot(snapshot: StationSnapshot, placement: PlacedStation): Station {
  const stationType = getStationTypeTemplate(snapshot.typeId);
  const required = snapshot.build!.waresRequired;
  const inventory: InventorySlot[] = snapshot.inventory.map((slotSnapshot) => {
    // Validator guarantees slotSnapshot.wareId is "provisions" or "hulls"
    // here; cast keeps the types honest.
    const max = required[slotSnapshot.wareId as "provisions" | "hulls"];
    const slot = createInventorySlot(getWareTemplate(slotSnapshot.wareId), slotSnapshot.current, max);
    slot.reservedIncoming = slotSnapshot.reservedIncoming;
    slot.reservedOutgoing = slotSnapshot.reservedOutgoing;
    return slot;
  });
  return assembleStation(
    placement,
    stationType,
    inventory,
    `Building ${stationType.name} (${snapshot.size})`,
  );
}

/** Restore a station whose state is producing / emigrating: rebuild
 *  canonical inventory via `createStation(..., 0)` so slot.max picks up the
 *  current `economyConfig.targetFillTimeSeconds`, then overlay snapshot mutable
 *  per-slot state. */
function stationFromOperatingSnapshot(snapshot: StationSnapshot, placement: PlacedStation): Station {
  const station = createStation(placement, 0);
  for (const slotSnapshot of snapshot.inventory) {
    const slot = station.inventoryByWareId.get(slotSnapshot.wareId);
    if (!slot) {
      throw new Error(
        `stationFromSnapshot: station ${snapshot.id} snapshot has slot for ${slotSnapshot.wareId}, which the current station type does not produce/consume`,
      );
    }
    slot.current = slotSnapshot.current;
    slot.reservedIncoming = slotSnapshot.reservedIncoming;
    slot.reservedOutgoing = slotSnapshot.reservedOutgoing;
  }
  return station;
}

/** Rebuild a Station from its snapshot — fresh object, no in-place mutation. */
export function stationFromSnapshot(snapshot: StationSnapshot): Station {
  const nation = getNationById(snapshot.nationId);
  const placement: PlacedStation = {
    id: snapshot.id,
    name: snapshot.name,
    x: snapshot.x,
    y: snapshot.y,
    nation,
    stationTypeId: snapshot.typeId,
    size: snapshot.size,
    state: snapshot.state,
    build: snapshot.build
      ? {
          waresRequired: { ...snapshot.build.waresRequired },
          contractingNationId: snapshot.build.contractingNationId,
        }
      : undefined,
    zoneId: snapshot.zoneId,
  };

  const station =
    snapshot.state === "building"
      ? stationFromBuildingSnapshot(snapshot, placement)
      : stationFromOperatingSnapshot(snapshot, placement);

  // Derived progress fields start at 0; emigration-manager refreshes them on first post-load tick.
  if (snapshot.emigrationEvent) station.emigrationEvent = emigrationFromSnapshot(snapshot.emigrationEvent);
  if (snapshot.generationalShipBuild)
    station.generationalShipBuild = generationalShipBuildFromSnapshot(snapshot.generationalShipBuild);
  return station;
}
