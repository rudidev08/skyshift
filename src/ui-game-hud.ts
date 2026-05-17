// HUD update path for the Game scene's selection card and sector card.
// Game.update() calls updateGameHud once per frame.

import { setAttrIfChanged, setHtmlIfChanged, setTextIfChanged } from "./ui-dom-cache";
import { morseBarGradient } from "./render-morse-bar";
import { getSectorHudIcon } from "./render-hud-icon";
import { shouldUpdateUI } from "./render-dirty-state";
import { sectorEnvironmentById, type SectorEnvironmentId } from "../data/map-sector-environments";
import { getStationTypeTemplate } from "./sim-station-template";

interface SelectionLabel {
  iconUri: string;
  stackLabel: string;
  name: string;
  serialCode: string;
  description: string;
  loreTypeName: string;
  lore: string;
  hasDetails: boolean;
  accentColor: string;
  statusLabel: string;
}

interface HudSelectionTarget {
  getSelectedLabel(): SelectionLabel | null;
}

interface HudSelectionState {
  interactive: boolean;
  selectedTarget: HudSelectionTarget | null;
}

export interface GameHudSector {
  name: string;
  lore: string;
  gridX: number;
  gridY: number;
  environment?: string;
}

/** The Game scene satisfies this structurally — no class import needed. */
export interface GameHudHost {
  selection: HudSelectionState;
  lastSelectionTarget: HudSelectionTarget | null;
  lastDetailsPanelOpen: boolean;
  lastHudTick: number;
  /** Last sector shown in the card, as "gridX,gridY" ("" = none). Edge-tracks
   *  camera panning so the sector card refreshes on boundary crossings. */
  lastHudSectorKey: string;
  simulation?: { economyTimer: { tickCount: number } };
  lastIconUri: string;
  lastAccentColor: string;
  selectedObjectEl: HTMLElement;
  selectedTypeEl: HTMLElement;
  serialCodeEl: HTMLElement;
  descriptionEl: HTMLElement;
  statusBandEl: HTMLElement;
  loreEl: HTMLElement;
  loreTitleEl: HTMLElement;
  hudIconEl: HTMLElement;
  infoCardEl: HTMLElement;
  loreToggleEl: HTMLElement;
  logToggleEl: HTMLElement;
  detailsContentEl: HTMLElement;
  detailsBoxEl: HTMLElement;
  /** Returns HTML for the details panel when a details-bearing target is selected. */
  getSelectionDetailsLog(): string;
}

const EMPTY_LABEL: SelectionLabel = {
  iconUri: "",
  stackLabel: "",
  name: "",
  serialCode: "",
  description: "",
  loreTypeName: "",
  lore: "",
  hasDetails: false,
  accentColor: "",
  statusLabel: "",
};

/** Sector info card body: green-accented Supports Stations list, split into two
 *  rows for compactness. Environment name lives in the status band. */
function buildSectorDescriptionHtml(sectorEnvironment: SectorEnvironmentId | undefined): string {
  if (!sectorEnvironment) return "";
  const supportedTypes = sectorEnvironmentById[sectorEnvironment].allowedStationTypeIds;
  const typeNames = supportedTypes.map((id) => getStationTypeTemplate(id).name);
  const middleIndex = Math.ceil(typeNames.length / 2);
  const firstRow = typeNames.slice(0, middleIndex).join(" · ");
  const secondRow = typeNames.slice(middleIndex).join(" · ");
  const rows = secondRow ? `${firstRow}<br>${secondRow}` : firstRow;
  const stationsList = typeNames.length === 0 ? "None" : rows;
  return `
    <div class="cargo-note">
      <span class="cargo-note-label" style="color: var(--accent);">Supports Stations</span>
      <div class="cargo-note-value">${stationsList}</div>
    </div>
  `;
}

export function updateGameHud(host: GameHudHost, sector: GameHudSector | undefined): void {
  // Editor manages the top-left panel directly — skip HUD updates.
  if (!host.selection.interactive) return;
  if (!prepareHudFrame(host, sector)) return;

  const label = host.selection.selectedTarget?.getSelectedLabel() ?? buildSectorSelectionLabel(sector);
  host.descriptionEl.classList.toggle(
    "cargo-grid--narrow-label",
    !host.selection.selectedTarget && Boolean(sector),
  );
  writeLabelToHud(host, label);
}

/** Whether the selection/sector HUD card should re-render this frame.
 *
 *  The card shows the selected entity, or — when nothing is selected — the
 *  sector under the camera. Entity data changes with the sim, so it's
 *  rate-limited by the per-tick throttle. The sector is a pure function of
 *  camera position, so when the sector card is showing it must also refresh
 *  the moment the camera pans across a boundary — including while the game is
 *  paused, when no tick ever elapses to fire the throttle. */
export function shouldRefreshSelectionHud(triggers: {
  selectionChanged: boolean;
  detailsPanelJustOpened: boolean;
  tickThrottleElapsed: boolean;
  showingSectorCard: boolean;
  sectorChanged: boolean;
}): boolean {
  return (
    triggers.selectionChanged ||
    triggers.detailsPanelJustOpened ||
    triggers.tickThrottleElapsed ||
    (triggers.showingSectorCard && triggers.sectorChanged)
  );
}

/** Returns true if the HUD should refresh this frame, and edge-tracks the
 *  per-frame state the decision compares against. See shouldRefreshSelectionHud. */
function prepareHudFrame(host: GameHudHost, sector: GameHudSector | undefined): boolean {
  const selectionChanged = host.selection.selectedTarget !== host.lastSelectionTarget;
  host.lastSelectionTarget = host.selection.selectedTarget;
  if (selectionChanged) {
    // Clear the details pane so cached innerHTML doesn't short-circuit the swap.
    host.detailsContentEl.innerHTML = "";
  }
  const detailsPanelOpen = host.detailsBoxEl.style.display !== "none";
  const detailsPanelJustOpened = detailsPanelOpen && !host.lastDetailsPanelOpen;
  host.lastDetailsPanelOpen = detailsPanelOpen;

  const sectorKey = sector ? `${sector.gridX},${sector.gridY}` : "";
  const sectorChanged = sectorKey !== host.lastHudSectorKey;
  host.lastHudSectorKey = sectorKey;

  const currentTick = host.simulation?.economyTimer.tickCount ?? 0;
  const refresh = shouldRefreshSelectionHud({
    selectionChanged,
    detailsPanelJustOpened,
    tickThrottleElapsed: shouldUpdateUI(currentTick, host.lastHudTick, true),
    showingSectorCard: !host.selection.selectedTarget,
    sectorChanged,
  });
  if (!refresh) return false;
  host.lastHudTick = currentTick;
  return true;
}

function buildSectorSelectionLabel(sector: GameHudSector | undefined): SelectionLabel {
  if (!sector) return EMPTY_LABEL;
  const initials = sector.name.slice(0, 2).toUpperCase();
  const sectorEnvironment = sector.environment as SectorEnvironmentId | undefined;
  const environmentLabel = sectorEnvironment
    ? `Environment: ${sectorEnvironmentById[sectorEnvironment].name}`
    : "";
  return {
    iconUri: getSectorHudIcon(),
    stackLabel: `Sector · coords (${sector.gridX},${sector.gridY})`,
    name: sector.name,
    serialCode: `SCT-${initials}`,
    description: buildSectorDescriptionHtml(sectorEnvironment),
    loreTypeName: `Sector: ${sector.name}`,
    lore: sector.lore,
    hasDetails: false,
    accentColor: "",
    statusLabel: environmentLabel,
  };
}

function writeLabelToHud(host: GameHudHost, label: SelectionLabel): void {
  // iconUri changes write three things (background-image + --id-icon + lastIconUri), so diff once locally instead of using dom-cache (which only diffs single writes).
  if (label.iconUri !== host.lastIconUri) {
    const imageValue = label.iconUri ? `url("${label.iconUri}")` : "";
    host.hudIconEl.style.backgroundImage = imageValue;
    if (imageValue) host.infoCardEl.style.setProperty("--id-icon", imageValue);
    else host.infoCardEl.style.removeProperty("--id-icon");
    host.lastIconUri = label.iconUri;
  }
  setTextIfChanged(host.selectedTypeEl, label.stackLabel);
  if (setTextIfChanged(host.selectedObjectEl, label.name)) {
    host.infoCardEl.style.setProperty("--morse-bar", morseBarGradient(label.name));
  }
  setTextIfChanged(host.serialCodeEl, label.serialCode);
  if (label.accentColor !== host.lastAccentColor) {
    if (label.accentColor) host.infoCardEl.style.setProperty("--nation-accent", label.accentColor);
    else host.infoCardEl.style.removeProperty("--nation-accent");
    host.lastAccentColor = label.accentColor;
  }
  setHtmlIfChanged(host.descriptionEl, label.description);
  if (setTextIfChanged(host.statusBandEl, label.statusLabel)) {
    host.statusBandEl.hidden = label.statusLabel.length === 0;
  }
  setTextIfChanged(host.loreTitleEl, label.loreTypeName);
  setTextIfChanged(host.loreEl, label.lore);

  publishLoreAndLogButtonAvailability(host, label);
  if (label.hasDetails) refreshOpenTradeLog(host);
}

/** Toggle clickable state on the lore and trade-log buttons in the dossier's
 *  info-rail based on whether the selection has lore and details. */
function publishLoreAndLogButtonAvailability(host: GameHudHost, label: SelectionLabel): void {
  const hasLore = label.lore.length > 0;
  const loreChanged = setAttrIfChanged(host.loreToggleEl, "data-has-lore", String(hasLore));
  const detailsChanged = setAttrIfChanged(host.logToggleEl, "data-has-details", String(label.hasDetails));
  if (loreChanged || detailsChanged) {
    // Notify the toggle button to re-run its click-availability check now that data-has-lore / data-has-details changed.
    host.loreToggleEl.dispatchEvent(new CustomEvent("reapply"));
    host.loreToggleEl.classList.toggle("is-available", hasLore);
    host.logToggleEl.classList.toggle("is-available", label.hasDetails);
  }
}

/** Write the latest trade-log HTML into the details drawer when it's open. */
function refreshOpenTradeLog(host: GameHudHost): void {
  if (host.detailsBoxEl.style.display === "none") return;
  setHtmlIfChanged(host.detailsContentEl, host.getSelectionDetailsLog());
}
