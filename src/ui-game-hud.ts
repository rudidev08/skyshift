// HUD update path for the Game scene's selection card and sector card.
// Game.update() calls updateGameHud once per frame.

import { setAttrIfChanged, setHtmlIfChanged, setTextIfChanged } from "./ui-dom-cache";
import { morseBarGradient } from "./render-morse-bar";
import { getSectorHudIcon } from "./render-hud-icon";
import { shouldUpdateUI } from "./render-dirty-state";
import { sectorEnvironmentById, type SectorEnvironmentId } from "../data/map-sector-environments";
import { getStationTypeTemplate } from "./sim-station-template";
import { EMPTY_SELECTION_LABEL } from "./render-selection-label";
import type { SelectionLabel, SelectionTarget } from "./render-selection-label";

export interface GameHudSector {
  name: string;
  lore: string;
  gridX: number;
  gridY: number;
  environment?: string;
}

/** The Game scene satisfies this structurally — no class import needed. */
export interface GameHudHost {
  selection: { interactive: boolean; selectedTarget: SelectionTarget | null };
  lastSelectionTarget: SelectionTarget | null;
  lastLogPanelOpen: boolean;
  lastHudTick: number;
  /** Last sector shown in the card, as "gridX,gridY" ("" = none). Edge-tracks
   *  camera panning so the sector card refreshes on boundary crossings. */
  lastHudSectorKey: string;
  simulation?: { economyTimer: { tickCount: number } };
  lastIconUri: string;
  lastAccentColor: string;
  selectedObjectElement: HTMLElement;
  selectedTypeElement: HTMLElement;
  serialCodeElement: HTMLElement;
  descriptionElement: HTMLElement;
  statusBandElement: HTMLElement;
  loreElement: HTMLElement;
  loreTitleElement: HTMLElement;
  hudIconElement: HTMLElement;
  infoCardElement: HTMLElement;
  loreToggleElement: HTMLElement;
  logToggleElement: HTMLElement;
  logContentElement: HTMLElement;
  logBoxElement: HTMLElement;
  /** Returns HTML for the log panel when the selected target has a trade log. */
  getSelectionTradeLog(): string;
}

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
  if (!shouldRepaintHudThisFrame(host, sector)) return;

  const label = host.selection.selectedTarget?.getSelectedLabel() ?? buildSectorSelectionLabel(sector);
  host.descriptionElement.classList.toggle(
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
  logPanelJustOpened: boolean;
  tickThrottleElapsed: boolean;
  showingSectorCard: boolean;
  sectorChanged: boolean;
}): boolean {
  return (
    triggers.selectionChanged ||
    triggers.logPanelJustOpened ||
    triggers.tickThrottleElapsed ||
    (triggers.showingSectorCard && triggers.sectorChanged)
  );
}

/** Mutates the host's last-seen selection/sector/log/tick fields as a side
 *  effect of the dirty check. See shouldRefreshSelectionHud for the rules. */
function shouldRepaintHudThisFrame(host: GameHudHost, sector: GameHudSector | undefined): boolean {
  const selectionChanged = host.selection.selectedTarget !== host.lastSelectionTarget;
  host.lastSelectionTarget = host.selection.selectedTarget;
  if (selectionChanged) {
    // Clear immediately so the drawer shows blank instead of the previous entity's log.
    setHtmlIfChanged(host.logContentElement, "");
  }
  const logPanelOpen = host.logBoxElement.style.display !== "none";
  const logPanelJustOpened = logPanelOpen && !host.lastLogPanelOpen;
  host.lastLogPanelOpen = logPanelOpen;

  const sectorKey = sector ? `${sector.gridX},${sector.gridY}` : "";
  const sectorChanged = sectorKey !== host.lastHudSectorKey;
  host.lastHudSectorKey = sectorKey;

  const currentTick = host.simulation?.economyTimer.tickCount ?? 0;
  const refresh = shouldRefreshSelectionHud({
    selectionChanged,
    logPanelJustOpened,
    tickThrottleElapsed: shouldUpdateUI(currentTick, host.lastHudTick, true),
    showingSectorCard: !host.selection.selectedTarget,
    sectorChanged,
  });
  if (!refresh) return false;
  host.lastHudTick = currentTick;
  return true;
}

function buildSectorSelectionLabel(sector: GameHudSector | undefined): SelectionLabel {
  if (!sector) return EMPTY_SELECTION_LABEL;
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
    hasLog: false,
    accentColor: "",
    statusLabel: environmentLabel,
  };
}

/** background-image and --id-icon must stay in sync, so a single local
 *  comparison (lastIconUri) covers both writes rather than splitting across
 *  two dom-cache entries. */
function writeHudIconIfChanged(host: GameHudHost, iconUri: string): void {
  if (iconUri === host.lastIconUri) return;
  const imageValue = iconUri ? `url("${iconUri}")` : "";
  host.hudIconElement.style.backgroundImage = imageValue;
  if (imageValue) host.infoCardElement.style.setProperty("--id-icon", imageValue);
  else host.infoCardElement.style.removeProperty("--id-icon");
  host.lastIconUri = iconUri;
}

function writeLabelToHud(host: GameHudHost, label: SelectionLabel): void {
  writeHudIconIfChanged(host, label.iconUri);
  setTextIfChanged(host.selectedTypeElement, label.stackLabel);
  if (setTextIfChanged(host.selectedObjectElement, label.name)) {
    host.infoCardElement.style.setProperty("--morse-bar", morseBarGradient(label.name));
  }
  setTextIfChanged(host.serialCodeElement, label.serialCode);
  if (label.accentColor !== host.lastAccentColor) {
    if (label.accentColor) host.infoCardElement.style.setProperty("--nation-accent", label.accentColor);
    else host.infoCardElement.style.removeProperty("--nation-accent");
    host.lastAccentColor = label.accentColor;
  }
  setHtmlIfChanged(host.descriptionElement, label.description);
  if (setTextIfChanged(host.statusBandElement, label.statusLabel)) {
    host.statusBandElement.hidden = label.statusLabel.length === 0;
  }
  setTextIfChanged(host.loreTitleElement, label.loreTypeName);
  setTextIfChanged(host.loreElement, label.lore);

  refreshInfoRailButtonStates(host, label);
  if (label.hasLog) refreshOpenTradeLog(host);
}

/** Update lore/trade-log button availability in the info-rail, and close any
 *  panel that the new selection no longer supports. */
function refreshInfoRailButtonStates(host: GameHudHost, label: SelectionLabel): void {
  const hasLore = label.lore.length > 0;
  const loreChanged = setAttrIfChanged(host.loreToggleElement, "data-has-lore", String(hasLore));
  const logChanged = setAttrIfChanged(host.logToggleElement, "data-has-log", String(label.hasLog));
  if (loreChanged || logChanged) {
    // Fires applyToggles in game-entry-hud.ts — closes any open panel whose content just disappeared.
    host.loreToggleElement.dispatchEvent(new CustomEvent("reapply"));
    host.loreToggleElement.classList.toggle("is-available", hasLore);
    host.logToggleElement.classList.toggle("is-available", label.hasLog);
  }
}

function refreshOpenTradeLog(host: GameHudHost): void {
  if (host.logBoxElement.style.display === "none") return;
  setHtmlIfChanged(host.logContentElement, host.getSelectionTradeLog());
}
