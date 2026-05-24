// Producer/consumer topology indexed by ware, so trade decisions can ask "which stations
// produce/consume X?" without scanning every station. Owned by a Simulation instance (one
// per game / editor preview / CLI run). Rebuilt on station add/remove, state flip, or save-load.
//
// Membership: producers are tradeable, non-building stations whose produces list
// includes the ware. Consumers are every other slot on a tradeable station — and
// every slot on a building station, since construction is inbound-only.

import type { WareId } from "../data/ware-types";
import {
  canStationTrade,
  getAllInventorySlots,
  isStationUnderConstruction,
  type Station,
} from "./sim-station";

export class WareStationIndex {
  private producersByWare = new Map<WareId, Station[]>();
  private consumersByWare = new Map<WareId, Station[]>();

  rebuild(stations: readonly Station[]): void {
    this.producersByWare.clear();
    this.consumersByWare.clear();

    for (const station of stations) {
      if (!canStationTrade(station)) continue;
      const isUnderConstruction = isStationUnderConstruction(station);
      const produces = station.stationType.produces;

      for (const slot of getAllInventorySlots(station)) {
        const isOutputSlot = !isUnderConstruction && produces.includes(slot.ware.id);
        const target = isOutputSlot ? this.producersByWare : this.consumersByWare;
        let list = target.get(slot.ware.id);
        if (!list) {
          list = [];
          target.set(slot.ware.id, list);
        }
        list.push(station);
      }
    }
  }

  getProducers(wareId: WareId): readonly Station[] {
    return this.producersByWare.get(wareId) ?? EMPTY_STATION_LIST;
  }

  /** Includes every slot on a station under construction. */
  getConsumers(wareId: WareId): readonly Station[] {
    return this.consumersByWare.get(wareId) ?? EMPTY_STATION_LIST;
  }

  /** Wares with no producers are absent — the map only gains a key when a station is added. */
  producedWaresWithStations(): IterableIterator<[WareId, readonly Station[]]> {
    return this.producersByWare.entries();
  }
}

// Shared empty-return so accessors don't allocate `[]` per miss.
const EMPTY_STATION_LIST: readonly Station[] = [];
