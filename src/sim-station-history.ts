// Records lifecycle events for stations (created / state-changed / removed) so
// the Overview's Stations Timelapse Log can render historical state. Pure data;
// no Phaser, no DOM. Memory footprint is O(events) — typically ~50 events for
// a 20-day game.

import { wayNation } from "../data/nations";
import type { StationTypeId } from "../data/station-types";
import type { TimelapseFrame, TimelapseStation } from "./sim-timelapse-state";

export const HISTORY_STATION_STATES = ["operational", "construction"] as const;
export type HistoryStationState = (typeof HISTORY_STATION_STATES)[number];

export interface HistoryStation {
  id: string;
  position: { x: number; y: number };
  nationId: string;
  typeId: StationTypeId;
  state: HistoryStationState;
}

export type StationLifecycleEvent =
  | { time: number; kind: "created"; station: HistoryStation }
  | { time: number; kind: "state-changed"; stationId: string; newState: HistoryStationState }
  | { time: number; kind: "removed"; stationId: string };

export interface StationHistory {
  recordCreated(time: number, station: HistoryStation): void;
  recordStateChanged(time: number, stationId: string, newState: HistoryStationState): void;
  recordRemoved(time: number, stationId: string): void;
  /** State of all live stations at `time` (inclusive). */
  getStateAt(time: number): TimelapseFrame;
  /** Per-nation station counts at `time`, with WAY excluded. */
  getCountsAt(time: number): Map<string, number>;
  toSnapshot(): StationLifecycleEvent[];
  fromSnapshot(events: StationLifecycleEvent[]): void;
  reset(): void;
}

/** Defensive deep copy: callers may JSON-stringify or mutate. Only `created`
 *  events carry a nested object (station + position); the others are flat. */
function cloneEvent(event: StationLifecycleEvent): StationLifecycleEvent {
  if (event.kind === "created")
    return { ...event, station: { ...event.station, position: { ...event.station.position } } };
  return { ...event };
}

export function createStationHistory(): StationHistory {
  let recordedEvents: StationLifecycleEvent[] = [];

  const liveStationsAt = (time: number): Map<string, HistoryStation> => {
    const live = new Map<string, HistoryStation>();
    for (const event of recordedEvents) {
      if (event.time > time) break;
      if (event.kind === "created") {
        live.set(event.station.id, event.station);
      } else if (event.kind === "state-changed") {
        const existing = live.get(event.stationId);
        if (existing) live.set(event.stationId, { ...existing, state: event.newState });
      } else if (event.kind === "removed") {
        live.delete(event.stationId);
      }
    }
    return live;
  };

  return {
    recordCreated(time, station) {
      recordedEvents.push({ time, kind: "created", station });
    },
    recordStateChanged(time, stationId, newState) {
      recordedEvents.push({ time, kind: "state-changed", stationId, newState });
    },
    recordRemoved(time, stationId) {
      recordedEvents.push({ time, kind: "removed", stationId });
    },
    getStateAt(time) {
      const live = liveStationsAt(time);
      const stations: TimelapseStation[] = [];
      for (const station of live.values()) {
        stations.push({
          id: station.id,
          position: station.position,
          nationId: station.nationId,
          typeId: station.typeId,
          state: station.state,
        });
      }
      return { simSeconds: time, stations };
    },
    getCountsAt(time) {
      const live = liveStationsAt(time);
      const counts = new Map<string, number>();
      for (const station of live.values()) {
        if (station.nationId === wayNation.id) continue;
        counts.set(station.nationId, (counts.get(station.nationId) ?? 0) + 1);
      }
      return counts;
    },
    toSnapshot() {
      return recordedEvents.map(cloneEvent);
    },
    fromSnapshot(events) {
      recordedEvents = events.slice();
    },
    reset() {
      recordedEvents = [];
    },
  };
}
