// Records lifecycle events for stations (created / state-changed / removed) so
// the Overview's Stations Timelapse Log can render historical state. Pure data;
// no Phaser, no DOM. Memory footprint is O(events) — typically ~50 events for
// a 20-day game.

import { wayNation } from "../data/nations";
import type { TimelapseStation, TimelapseStationState } from "./sim-timelapse-state";

export type StationLifecycleEvent =
  | { timeSeconds: number; kind: "created"; station: TimelapseStation }
  | { timeSeconds: number; kind: "state-changed"; stationId: string; newState: TimelapseStationState }
  | { timeSeconds: number; kind: "removed"; stationId: string };

export interface StationHistory {
  recordCreated(timeSeconds: number, station: TimelapseStation): void;
  recordStateChanged(timeSeconds: number, stationId: string, newState: TimelapseStationState): void;
  recordRemoved(timeSeconds: number, stationId: string): void;
  /** State of all live stations at `timeSeconds` (inclusive). */
  getStateAt(timeSeconds: number): TimelapseStation[];
  /** Per-nation station counts at `timeSeconds`, with WAY excluded. */
  getCountsAt(timeSeconds: number): Map<string, number>;
  toSnapshot(): StationLifecycleEvent[];
  fromSnapshot(events: StationLifecycleEvent[]): void;
  reset(): void;
}

export function createStationHistory(): StationHistory {
  let recordedEvents: StationLifecycleEvent[] = [];

  const computeLiveStationsAt = (timeSeconds: number): Map<string, TimelapseStation> => {
    const liveStations = new Map<string, TimelapseStation>();
    for (const event of recordedEvents) {
      if (event.timeSeconds > timeSeconds) break;
      if (event.kind === "created") {
        liveStations.set(event.station.id, event.station);
      } else if (event.kind === "state-changed") {
        const existing = liveStations.get(event.stationId);
        if (existing) liveStations.set(event.stationId, { ...existing, state: event.newState });
      } else if (event.kind === "removed") {
        liveStations.delete(event.stationId);
      }
    }
    return liveStations;
  };

  return {
    recordCreated(timeSeconds, station) {
      recordedEvents.push({ timeSeconds, kind: "created", station });
    },
    recordStateChanged(timeSeconds, stationId, newState) {
      recordedEvents.push({ timeSeconds, kind: "state-changed", stationId, newState });
    },
    recordRemoved(timeSeconds, stationId) {
      recordedEvents.push({ timeSeconds, kind: "removed", stationId });
    },
    getStateAt(timeSeconds) {
      return [...computeLiveStationsAt(timeSeconds).values()];
    },
    getCountsAt(timeSeconds) {
      const liveStations = computeLiveStationsAt(timeSeconds);
      const counts = new Map<string, number>();
      for (const station of liveStations.values()) {
        if (station.nationId === wayNation.id) continue;
        counts.set(station.nationId, (counts.get(station.nationId) ?? 0) + 1);
      }
      return counts;
    },
    toSnapshot() {
      return recordedEvents.slice();
    },
    fromSnapshot(events) {
      recordedEvents = events.slice();
    },
    reset() {
      recordedEvents = [];
    },
  };
}
