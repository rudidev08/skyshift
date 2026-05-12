// HUD update path for the Game scene's selection card and sector card.
// Game.update() calls updateGameHud once per frame.

import { setAttrIfChanged, setHtmlIfChanged, setTextIfChanged } from "./ui-dom-cache";
import { morseBarGradient } from "./render-morse-bar";
import { getSectorHudIcon } from "./render-hud-icon";
import { shouldUpdateUI } from "./phaser/viewport-culling";
import { formatEnvironment } from "./render-sector-label";
import { ENVIRONMENT_ALLOWED_TYPES, type EnvironmentId } from "../data/map-environments";
import { getStationTemplate } from "./sim-station-template";

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

interface SelectionTargetLike {
  getSelectedLabel(): SelectionLabel | null;
}

interface SelectionLike {
  enabled: boolean;
  target: SelectionTargetLike | null;
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
  selection: SelectionLike;
  lastSelectionTarget: SelectionTargetLike | null;
  lastDetailsPanelOpen: boolean;
  lastHudTick: number;
  simulation?: { economyTimer: { tick: number } };
  lastSealUri: string;
  lastAccentColor: string;
  selectedObjectEl: HTMLElement;
  selectedTypeEl: HTMLElement;
  serialCodeEl: HTMLElement;
  descriptionEl: HTMLElement;
  statusBandEl: HTMLElement;
  loreEl: HTMLElement;
  loreTitleEl: HTMLElement;
  hudSealEl: HTMLElement;
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
export function buildSectorDescriptionHtml(environment: EnvironmentId | undefined): string {
  if (!environment) return "";
  const supportedTypes = ENVIRONMENT_ALLOWED_TYPES[environment] ?? [];
  const typeNames = supportedTypes.map((id) => getStationTemplate(id).name);
  let stationsList: string;
  if (typeNames.length === 0) {
    stationsList = "None";
  } else {
    const middleIndex = Math.ceil(typeNames.length / 2);
    const first = typeNames.slice(0, middleIndex).join(" · ");
    const second = typeNames.slice(middleIndex).join(" · ");
    stationsList = second ? `${first}<br>${second}` : first;
  }
  return `
    <div class="cargo-note">
      <span class="cargo-note-label" style="color: var(--accent);">Supports Stations</span>
      <div class="cargo-note-value">${stationsList}</div>
    </div>
  `;
}

export function updateGameHud(host: GameHudHost, sector: GameHudSector | undefined): void {
  // Editor manages the top-left panel directly — skip HUD updates.
  if (!host.selection.enabled) return;
  if (!prepareHudFrame(host)) return;

  const label = host.selection.target?.getSelectedLabel() ?? buildSectorSelectionLabel(sector);
  host.descriptionEl.classList.toggle(
    "cargo-grid--narrow-label",
    !host.selection.target && Boolean(sector),
  );
  setHud(host, label);
}

/** Returns true if the HUD should refresh this frame. Refresh fires on
 *  selection change, details-panel opening, or per-tick throttle. */
function prepareHudFrame(host: GameHudHost): boolean {
  const selectionChanged = host.selection.target !== host.lastSelectionTarget;
  host.lastSelectionTarget = host.selection.target;
  if (selectionChanged) {
    // Clear the details pane so cached innerHTML doesn't short-circuit the swap.
    host.detailsContentEl.innerHTML = "";
  }
  const detailsPanelOpen = host.detailsBoxEl.style.display !== "none";
  const detailsPanelJustOpened = detailsPanelOpen && !host.lastDetailsPanelOpen;
  host.lastDetailsPanelOpen = detailsPanelOpen;

  const currentTick = host.simulation?.economyTimer.tick ?? 0;
  if (!selectionChanged && !detailsPanelJustOpened && !shouldUpdateUI(currentTick, host.lastHudTick, true)) {
    return false;
  }
  host.lastHudTick = currentTick;
  return true;
}

function buildSectorSelectionLabel(sector: GameHudSector | undefined): SelectionLabel {
  if (!sector) return EMPTY_LABEL;
  const initials = sector.name.slice(0, 2).toUpperCase();
  const sectorEnvironment = sector.environment as EnvironmentId | undefined;
  const environmentLabel = sectorEnvironment ? `Environment: ${formatEnvironment(sectorEnvironment)}` : "";
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

function setHud(host: GameHudHost, label: SelectionLabel): void {
  // iconUri changes write three things (background-image + --id-icon + lastSealUri), so diff once locally instead of using dom-cache (which only diffs single writes).
  if (label.iconUri !== host.lastSealUri) {
    const imageValue = label.iconUri ? `url("${label.iconUri}")` : "";
    host.hudSealEl.style.backgroundImage = imageValue;
    if (imageValue) host.infoCardEl.style.setProperty("--id-icon", imageValue);
    else host.infoCardEl.style.removeProperty("--id-icon");
    host.lastSealUri = label.iconUri;
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

  setLoreAndLogButtonAvailability(host, label);
  if (label.hasDetails) refreshOpenTradeLog(host);
}

/** Toggle clickable state on the lore and trade-log buttons in the dossier's
 *  info-rail based on whether the selection has lore and details. */
function setLoreAndLogButtonAvailability(host: GameHudHost, label: SelectionLabel): void {
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
