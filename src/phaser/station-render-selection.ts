// Adapts a Station into the Selection system's SelectionTarget. Owns HUD
// id-card content (iconUri, description, lore) and enter/exit hooks.

import { getStationRates, getAllInventorySlots, type Station } from "../sim-station";
import { longNameBySize } from "../../data/stations";
import { economyConfig } from "../../data/economy-config";
import { announceStation } from "../audio-announcer";
import type { SelectionTarget } from "./selection-input";
import { getStationHudIcon } from "../render-hud-icon";
import { formatCargoBar } from "../util-quantity-format";
import { escapeHtml } from "../util-html-escape";
import { clamp01 } from "../util-clamp";
import type { StationGenerationalShipBuild } from "../sim-station-types";

// Reusable position for getMapPosition — only one station selected at a time.
const selectedStationMapPositionScratch = { x: 0, y: 0 };

// Cached per stationType.id — station types are static for process lifetime, so this never invalidates.
const producedWareIdsByStationTypeId = new Map<string, Set<string>>();

function getProducedWareIdsForStationType(stationType: Station["stationType"]): Set<string> {
  const cached = producedWareIdsByStationTypeId.get(stationType.id);
  if (cached) return cached;
  // No filter needed: data-integrity.test.ts pins that no station type lists a pure-sink ware in `produces`.
  const set = new Set<string>(stationType.produces);
  producedWareIdsByStationTypeId.set(stationType.id, set);
  return set;
}

function buildGenerationalShipDescription(build: StationGenerationalShipBuild | null): string {
  if (build) {
    const fraction = clamp01(build.arrivalFraction);
    const percent = Math.floor(fraction * 100);
    const destinationName = escapeHtml(build.destinationName);
    return `
      <div class="cargo-note cargo-note--heading">
        <span class="cargo-note-label">Destination</span>
        <div class="cargo-note-value"><span class="cargo-note-accent cargo-note-accent--lg">${destinationName}</span></div>
      </div>
      <div class="cargo-row">
        <span class="cargo-label">Boarding</span>
        <span class="cargo-track"><span class="cargo-fill" style="width: ${percent}%;"></span></span>
        <span class="cargo-stat">${percent}%</span>
      </div>
      <div class="cargo-note">
        <span class="cargo-note-label">Passengers</span>
        <div class="cargo-note-value">inbound<br><span class="cargo-note-dim">from ${build.emigratingStationCount} station${build.emigratingStationCount === 1 ? "" : "s"} total</span></div>
      </div>
    `;
  }
  // Generational ship is docked with no active emigration event.
  return `
    <div class="cargo-note">
      <span class="cargo-note-label">Ship status</span>
      <div class="cargo-note-value">Waiting for emigration</div>
    </div>
    <div class="cargo-note">
      <span class="cargo-note-label">Crew status</span>
      <div class="cargo-note-value">Enjoying shore leave</div>
    </div>
    <div class="cargo-note">
      <span class="cargo-note-label">Destination</span>
      <div class="cargo-note-value">—</div>
    </div>
  `;
}

function buildEmigratingDescription(emigration: Station["emigrationEvent"]): string {
  const fraction = emigration ? emigration.progressFraction : 0;
  const percent = Math.max(0, Math.min(100, Math.floor(fraction * 100)));
  const destinationName = emigration?.destinationName ? escapeHtml(emigration.destinationName) : "—";
  return `
    <div class="cargo-row">
      <span class="cargo-label">Emigration</span>
      <span class="cargo-track"><span class="cargo-fill" style="width: ${percent}%;"></span></span>
      <span class="cargo-stat">${percent}%</span>
    </div>
    <div class="cargo-note">
      <span class="cargo-note-label">Boarding</span>
      <div class="cargo-note-value">Generational ship <span class="cargo-note-accent">${destinationName}</span></div>
    </div>
  `;
}

function buildProducingDescription(station: Station): string {
  const ticksPerSecond = 1 / economyConfig.simulationIntervalSeconds;

  // Positive = produced, negative = consumed. Per-tick sim amounts get scaled
  // to /s for the cargo bar's "/s" label.
  const stationRates = getStationRates(station);
  const netRateByWareId = new Map<string, number>();
  for (const [wareId, amount] of stationRates.production) {
    netRateByWareId.set(wareId, (netRateByWareId.get(wareId) ?? 0) + amount * ticksPerSecond);
  }
  for (const [wareId, amount] of stationRates.consumption) {
    netRateByWareId.set(wareId, (netRateByWareId.get(wareId) ?? 0) - amount * ticksPerSecond);
  }

  const producedWareIds = getProducedWareIdsForStationType(station.stationType);

  // Section headers emit only for non-empty groups (e.g. a building tech
  // factory shows "▼ Consumes" alone, no dangling "▲ Produces").
  const producedBars: string[] = [];
  const consumedBars: string[] = [];
  for (const inventorySlot of getAllInventorySlots(station)) {
    const rate = netRateByWareId.get(inventorySlot.ware.id) ?? 0;
    const reservation = inventorySlot.reservedIncoming - inventorySlot.reservedOutgoing;
    const bar = formatCargoBar({
      wareName: inventorySlot.ware.name,
      current: inventorySlot.current,
      max: inventorySlot.max,
      rate,
      rateLabel: "/s",
      reservation,
    });
    if (producedWareIds.has(inventorySlot.ware.id)) {
      producedBars.push(bar);
    } else {
      consumedBars.push(bar);
    }
  }

  const sections: string[] = [];
  if (producedBars.length > 0) {
    sections.push('<div class="cargo-section">▲ Produces</div>', ...producedBars);
  }
  if (consumedBars.length > 0) {
    sections.push('<div class="cargo-section">▼ Consumes</div>', ...consumedBars);
  }
  return sections.join("");
}

function buildStationSelectionLabel(input: {
  station: Station;
  stackLabel: string;
  description: string;
  statusLabel: string;
}) {
  const { station, stackLabel, description, statusLabel } = input;
  return {
    iconUri: getStationHudIcon(station.stationType.id),
    stackLabel,
    name: station.name,
    serialCode: station.id,
    description,
    loreTypeName: `Station Type: ${station.stationType.name}`,
    lore: station.stationType.lore,
    hasLog: false,
    accentColor: station.nation.color,
    statusLabel,
  };
}

export class StationSelectionTarget implements SelectionTarget {
  readonly kind = "station" as const;
  constructor(readonly station: Station) {}

  enterSelected() {
    announceStation(this.station.name, this.station.stationType.name, this.station.nation);
  }

  /** Does nothing — selection auto-clears when the station bundle unregisters. */
  exitSelected() {}

  isActive() {
    // Always true: same auto-clear-on-unregister means isActive never has to flag a stale station.
    return true;
  }

  canSelect() {
    return true;
  }

  getSelectedLabel() {
    const station = this.station;
    const stationType = station.stationType;

    if (stationType.id === "generational-ship") {
      const build = station.generationalShipBuild;
      return buildStationSelectionLabel({
        station,
        stackLabel: station.nation.shortName,
        description: buildGenerationalShipDescription(build),
        statusLabel: build ? "Boarding in Progress" : "Shore Leave",
      });
    }

    const sizeLabel = longNameBySize[station.size];
    const state = station.state ?? "producing";

    if (state === "emigrating") {
      return buildStationSelectionLabel({
        station,
        stackLabel: `${stationType.name} · ${sizeLabel}`,
        description: buildEmigratingDescription(station.emigrationEvent),
        statusLabel: "Emigrating",
      });
    }

    return buildStationSelectionLabel({
      station,
      stackLabel: `${stationType.name} · ${sizeLabel}`,
      description: buildProducingDescription(station),
      statusLabel: state === "building" ? "In Construction" : "Producing",
    });
  }

  getMapPosition() {
    selectedStationMapPositionScratch.x = this.station.x;
    selectedStationMapPositionScratch.y = this.station.y;
    return selectedStationMapPositionScratch;
  }
}
