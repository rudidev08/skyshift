import type { WareId } from "../data/ware-types";
import type { Station } from "./sim-station-types";

/** Logical travel endpoint, identified by station + surfaceOrOrbit rather than coords so flights survive saves and orbital drift. surfaceOrOrbit drives approach-zone scaling in computePhaseBounds (surface = station-size-scaled, orbit = fixed); render resolves sprite positions per-frame. */
export type TravelEndpoint = {
  stationId: string;
  surfaceOrOrbit: "surface" | "orbit";
};

/** Local = same-station maneuver (e.g. surface→orbit deploy); inter-station =
 *  flight between two stations (gets nationSpeed multiplier + trail/ring-pulse
 *  visuals). */
export type TravelMode = "local" | "interStation";

/** A single step in a ship's action queue. */
export type ShipAction =
  /** `originStation` / `destinationStation` are runtime refs that survive
   *  mid-flight demolition (e.g. emigration ferry whose home was torn down).
   *  Logical endpoints still carry stationIds for save/load.
   *
   *  `route` is render-only: trade flights set it so the info card shows
   *  "Route: X to Y"; ferries, deploy legs, and other non-trade flights
   *  leave it undefined and the card renders `label` as a status line. */
  | {
      type: "fly";
      origin: TravelEndpoint;
      originStation: Station;
      destination: TravelEndpoint;
      destinationStation: Station;
      travelMode: TravelMode;
      deploying?: boolean;
      label: string;
      route?: { fromStation: Station; toStation: Station };
    }
  | { type: "wait"; duration: number; label: string }
  | { type: "cargo-withdrawal"; station: Station; wareId: WareId; amount: number }
  | { type: "cargo-deposit"; station: Station; wareId: WareId; amount: number }
  /** Ship flies to its destination station and disappears (fade-out). Used for emigration ferries and traders whose action queue was extended past their final delivery. */
  | { type: "decommission"; station: Station; label: string };
