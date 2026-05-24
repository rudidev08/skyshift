import type { WareId } from "../data/ware-types";
import type { Station } from "./sim-station-types";

/** Logical travel endpoint — identified by station + surfaceOrOrbit so flights survive saves and orbital drift. */
export type TravelEndpoint = {
  stationId: string;
  surfaceOrOrbit: "surface" | "orbit";
};

/** Local: same-station maneuver (e.g. surface→orbit deploy). Inter-station: flight between two stations. */
export type TravelMode = "local" | "interStation";

export type ShipAction =
  /** Flight between two endpoints. `originStation` / `destinationStation` are
   *  runtime refs that survive mid-flight demolition (e.g. emigration ferry
   *  whose home was torn down); logical endpoints still carry stationIds for
   *  save/load. `isTradeFlight` drives the info-card cargo-note only — a player
   *  trade flight sets it so the card shows "Route: X to Y" (derived from
   *  origin/destination station); ferries, deploy legs, and other non-trade
   *  flights leave it unset and the card falls back to `label` as a status line. */
  | {
      type: "fly";
      origin: TravelEndpoint;
      originStation: Station;
      destination: TravelEndpoint;
      destinationStation: Station;
      travelMode: TravelMode;
      deploying?: boolean;
      label: string;
      isTradeFlight?: boolean;
    }
  | { type: "wait"; durationSeconds: number; label: string }
  | { type: "cargo-withdrawal"; station: Station; wareId: WareId; amount: number }
  | { type: "cargo-deposit"; station: Station; wareId: WareId; amount: number }
  /** Ship flies to its destination station and disappears (fade-out). Used for emigration ferries and traders whose action queue was extended past their final delivery. */
  | { type: "decommission"; station: Station; label: string };
