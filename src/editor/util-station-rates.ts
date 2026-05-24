/** Build one record per `PlacedStation` carrying its runtime `Station` and `StationRates`, in input order. Used by the editor panels (fleet summary, stations table) to share the create-station/get-rates derivation. */

import type { PlacedStation } from "../../data/station-types";
import { createStation, getStationRates } from "../sim-station";
import type { Station, StationRates } from "../sim-station-types";

export interface StationRateRecord {
  placement: PlacedStation;
  station: Station;
  rates: StationRates;
}

export function buildStationRateRecords(stations: PlacedStation[]): StationRateRecord[] {
  return stations.map((placement) => {
    const station = createStation(placement);
    return { placement, station, rates: getStationRates(station) };
  });
}
