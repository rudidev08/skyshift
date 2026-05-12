// Adapts a Station into the Selection system's SelectionTarget. Owns HUD
// id-card content (iconUri, description, lore) and enter/exit hooks.

import { getStationRates, getAllInventorySlots, type Station } from "../sim-station";
import { longNameBySize } from "../../data/stations";
import { economyConfig } from "../../data/economy-config";
import { announceStation } from "../audio-announcer";
import type { SelectionTarget } from "./selection-input";
import { getStationHudIcon } from "../render-hud-icon";
import { getWareTemplate } from "../sim-ware-template";
import { formatCargoBar } from "../util-quantity-format";
import { escapeHtml } from "../util-html-escape";
import type { StationGenerationalShipBuild } from "../sim-station-types";

// Reusable position for getMapPosition — only one station selected at a time.
const stationMapPositionScratch = { x: 0, y: 0 };

/** Cached per stationType.id — station types are static for process lifetime, so this never invalidates. */
const producedWareIdsByStationTypeId = new Map<string, Set<string>>();

function getProducedWareIdsForStationType(stationType: Station["stationType"]): Set<string> {
  const cached = producedWareIdsByStationTypeId.get(stationType.id);
  if (cached) return cached;
  // "Produced" = listed in `produces` with non-zero productionOutput, so
  // pure-sink wares like passengers don't show.
  const set = new Set<string>();
  for (const wareId of stationType.produces) {
    if (getWareTemplate(wareId).productionOutput > 0) set.add(wareId);
  }
  producedWareIdsByStationTypeId.set(stationType.id, set);
  return set;
}

function buildGenerationalShipDescriptionHtml(build: StationGenerationalShipBuild | null): string {
  if (build) {
    const fraction = Math.max(0, Math.min(1, build.arrivalFraction));
    const percent = Math.floor(fraction * 100);
    const destinationName = escapeHtml(build.destinationName);
    return `
      <div class="cargo-note" style="border-top: none; padding-top: 0; margin-top: 0; padding-bottom: 8px; margin-bottom: 4px; border-bottom: 1px dashed var(--line);">
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
        <div class="cargo-note-value">inbound<br><span class="cargo-note-dim">from ${build.stationCount} station${build.stationCount === 1 ? "" : "s"} total</span></div>
      </div>
    `;
  }
  // Idle: generational ship docked, no event — crew ashore, waiting for the next call.
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

function buildEmigratingDescriptionHtml(emigration: Station["emigrationEvent"]): string {
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

function buildProducingDescriptionHtml(station: Station): string {
  const perSecond = 1 / economyConfig.simulationIntervalSeconds;

  // Net signed rate per ware: positive = produced, negative = consumed.
  // Per-tick sim amounts get scaled to /s for the cargo bar's "/s" label.
  const stationRates = getStationRates(station);
  const rates = new Map<string, number>();
  for (const [wareId, amount] of stationRates.production) {
    rates.set(wareId, (rates.get(wareId) ?? 0) + amount * perSecond);
  }
  for (const [wareId, amount] of stationRates.consumption) {
    rates.set(wareId, (rates.get(wareId) ?? 0) - amount * perSecond);
  }

  const producedWareIds = getProducedWareIdsForStationType(station.stationType);

  // Section headers emit only for non-empty groups (e.g. a building tech
  // factory shows "▼ Consumes" alone, no dangling "▲ Produces").
  const producedBars: string[] = [];
  const consumedBars: string[] = [];
  for (const inventorySlot of getAllInventorySlots(station)) {
    const rate = rates.get(inventorySlot.ware.id) ?? 0;
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

export class StationSelectionTarget implements SelectionTarget {
  readonly kind = "station" as const;
  constructor(readonly station: Station) {}

  enterSelected() {
    announceStation(
      this.station.name!,
      this.station.stationType.name,
      this.station.nation,
    );
  }

  exitSelected() {
  }

  isActive() {
    // Selection auto-clears on bundle unregister, so isActive never has to return false here.
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
      const statusLabel = build ? "Boarding in Progress" : "Shore Leave";
      return {
        iconUri: getStationHudIcon(stationType.id),
        stackLabel: station.nation.shortName,
        name: station.name!,
        serialCode: station.id,
        description: buildGenerationalShipDescriptionHtml(build),
        loreTypeName: `Station Type: ${stationType.name}`,
        lore: stationType.lore,
        hasDetails: false,
        accentColor: station.nation.color,
        statusLabel,
      };
    }

    const sizeLabel = longNameBySize[station.size];
    const state = station.state ?? "producing";

    if (state === "emigrating") {
      return {
        iconUri: getStationHudIcon(stationType.id),
        stackLabel: `${stationType.name} · ${sizeLabel}`,
        name: station.name!,
        serialCode: station.id,
        description: buildEmigratingDescriptionHtml(station.emigrationEvent),
        loreTypeName: `Station Type: ${stationType.name}`,
        lore: stationType.lore,
        hasDetails: false,
        accentColor: station.nation.color,
        statusLabel: "Emigrating",
      };
    }

    const statusLabel = state === "building" ? "In Construction" : "Producing";
    return {
      iconUri: getStationHudIcon(stationType.id),
      stackLabel: `${stationType.name} · ${sizeLabel}`,
      name: station.name!,
      serialCode: station.id,
      description: buildProducingDescriptionHtml(station),
      loreTypeName: `Station Type: ${stationType.name}`,
      lore: stationType.lore,
      hasDetails: false,
      accentColor: station.nation.color,
      statusLabel,
    };
  }

  getMapPosition() {
    stationMapPositionScratch.x = this.station.x;
    stationMapPositionScratch.y = this.station.y;
    return stationMapPositionScratch;
  }
}
