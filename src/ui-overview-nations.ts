// Per-nation status cards: name, desire tagline, station counts, blueprint footer, current build (or WAY's generational-ship lifecycle state).

import type { NationManager } from "./sim-nation-manager";
import type { EmigrationManager } from "./sim-emigration-manager";
import type { StationManager } from "./sim-station-manager";
import type { StationZone } from "./sim-station-zone-types";
import { stationBuilderNations, wayNation } from "../data/nations";
import { getStationTypeTemplate } from "./sim-station-template";
import { getInventorySlot, type Station } from "./sim-station";
import type { Nation } from "./sim-nation";
import { getStationHudIcon, getSectorHudIcon } from "./render-hud-icon";
import { morseBarGradient } from "./render-morse-bar";
import { escapeHtml } from "./util-html-escape";
import { formatHoursMinutesSeconds } from "./render-elapsed-time-label";
import { setHtmlIfChanged } from "./ui-dom-cache";

export interface NationsPane {
  update(): void;
  destroy(): void;
}

/** Managers + zone-name lookup the nations pane reads each render. */
export interface NationsPaneContext {
  nationManager: NationManager;
  emigrationManager: EmigrationManager;
  stationManager: StationManager;
  sectorNameByZoneId: Map<string, string>;
}

export interface NationsPaneOptions {
  root: HTMLElement;
  nationManager: NationManager;
  emigrationManager: EmigrationManager;
  stationManager: StationManager;
  zones: StationZone[];
}

/** Nation-code tab strip (HUB/BIO/ORE/SKY/FAR/WAY, one always on). Returns
 *  the root + setActive so the caller drives highlighting without re-reading
 *  DOM classes. */
interface NationsTabBar {
  root: HTMLElement;
  setActive(nationId: string): void;
}
function createNationsTabBar(
  tabNations: Nation[],
  initialActiveNationId: string,
  onChange: (nationId: string) => void,
): NationsTabBar {
  const tabBar = document.createElement("div");
  tabBar.className = "hud-segment hud-segment--row nation-tabs";
  const tabButtons = new Map<string, HTMLButtonElement>();
  for (const nation of tabNations) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hud-btn";
    button.style.setProperty("--nation-accent", nation.color);
    button.textContent = nation.codeName;
    button.addEventListener("click", () => onChange(nation.id));
    tabBar.appendChild(button);
    tabButtons.set(nation.id, button);
  }
  const setActive = (nationId: string): void => {
    for (const [id, button] of tabButtons) button.classList.toggle("is-on", id === nationId);
  };
  setActive(initialActiveNationId);
  return { root: tabBar, setActive };
}

/** Per-nation card pane. One card per entry in tabNations is kept in the DOM;
 *  only the active card is visible. */
interface NationsCardPane {
  root: HTMLElement;
  setActive(nationId: string): void;
  update(): void;
}
function createNationsCardPane(
  tabNations: Nation[],
  initialActiveNationId: string,
  dependencies: NationsPaneContext,
): NationsCardPane {
  const cardsContainer = document.createElement("div");
  cardsContainer.className = "nations-pane-cards";
  const cardsByNationId = new Map<string, HTMLElement>();
  for (const nation of tabNations) {
    const card = createEmptyNationCard(nation);
    cardsContainer.appendChild(card);
    cardsByNationId.set(nation.id, card);
  }
  const setActive = (nationId: string): void => {
    for (const [id, card] of cardsByNationId) card.hidden = id !== nationId;
  };
  setActive(initialActiveNationId);
  const update = (): void => {
    for (const nation of tabNations) {
      const card = cardsByNationId.get(nation.id);
      if (!card) continue;
      updateCardContent(card, nation, dependencies);
    }
  };
  return { root: cardsContainer, setActive, update };
}

export function createNationsPane(options: NationsPaneOptions): NationsPane {
  const { root, nationManager, emigrationManager, stationManager, zones } = options;
  root.innerHTML = "";

  const tabNations: Nation[] = [...stationBuilderNations, wayNation];
  const initialActiveNationId = tabNations[0]?.id ?? "";
  const context: NationsPaneContext = {
    nationManager,
    emigrationManager,
    stationManager,
    sectorNameByZoneId: buildSectorNameByZoneId(zones),
  };

  const cardPane = createNationsCardPane(tabNations, initialActiveNationId, context);
  const tabBar = createNationsTabBar(tabNations, initialActiveNationId, (nationId) => {
    tabBar.setActive(nationId);
    cardPane.setActive(nationId);
  });

  const pane = document.createElement("div");
  pane.className = "nations-pane";
  pane.appendChild(tabBar.root);
  pane.appendChild(cardPane.root);
  root.appendChild(pane);

  cardPane.update();

  return {
    update: cardPane.update,
    destroy: () => {
      root.innerHTML = "";
    },
  };
}

/** Zone id → sector display name. Lets the build-progress row label the build location without re-walking the zone list per render. */
function buildSectorNameByZoneId(
  zones: ReadonlyArray<{ id: string; sector: { name: string } }>,
): Map<string, string> {
  const sectorNameByZoneId = new Map<string, string>();
  for (const zone of zones) sectorNameByZoneId.set(zone.id, zone.sector.name);
  return sectorNameByZoneId;
}

function createEmptyNationCard(nation: Nation): HTMLElement {
  const card = document.createElement("div");
  card.className = "nation-card";
  card.setAttribute("data-nation", nation.id);
  card.style.setProperty("--nation-accent", nation.color);
  card.style.setProperty("--morse-bar", morseBarGradient(nation.name, { color: nation.color }));
  // Footer is gated on buildsStations, not the blueprint list — WAY has
  // a generational ship in its blueprints (drives the seal + stat line) but runs no
  // build cycle, so its footer reads "none" while the row stays for layout parity.
  const buildsList = nation.buildsStations ? nation.buildableStationTypeIds.join(" · ") : "none";
  card.innerHTML = `
    <div class="id-header">
      <div class="id-title">
        <div class="id-name">${escapeHtml(nation.name)}</div>
        <div class="nation-desire">${renderNationDesire(nation.desire)}</div>
      </div>
      <div class="icon-code">
        <div class="id-seal" data-seal="nation-${nation.id}"></div>
        <div class="id-serial-code id-serial-code--stamp">${escapeHtml(nation.codeName)}</div>
      </div>
    </div>
    <div class="nation-stats" data-role="stats"></div>
    <div class="nation-foot"><span class="label">Builds stations</span><span class="items">${escapeHtml(buildsList)}</span></div>
    <div class="cargo-grid" data-role="activity"></div>
  `;
  // Seal glyph — each nation's primary buildable station as a ghosted
  // outline behind the code stamp. Empty-blueprint nations fall back to the
  // sector glyph.
  const sealUri =
    nation.buildableStationTypeIds.length > 0
      ? getStationHudIcon(nation.primaryBuildableStationTypeId)
      : getSectorHudIcon();
  const seal = card.querySelector<HTMLElement>(".id-seal");
  if (seal) seal.style.backgroundImage = `url("${sealUri}")`;
  return card;
}

function updateCardContent(card: HTMLElement, nation: Nation, dependencies: NationsPaneContext): void {
  const { nationManager, emigrationManager, stationManager, sectorNameByZoneId } = dependencies;
  const stats = card.querySelector<HTMLElement>('[data-role="stats"]');
  const activity = card.querySelector<HTMLElement>('[data-role="activity"]');

  if (stats) setHtmlIfChanged(stats, statsHtml(nation, stationManager));
  if (!activity) return;

  if (nation.id === "way") {
    setHtmlIfChanged(activity, wayActivityHtml(emigrationManager));
  } else {
    setHtmlIfChanged(
      activity,
      buildingActivityHtml({ nation, nationManager, stationManager, sectorNameByZoneId }),
    );
  }
}

/** Render a nation's desire field — verb in bold, object in plain text. */
function renderNationDesire(desire: { verb: string; object: string }): string {
  return `<b>${escapeHtml(desire.verb)}</b> ${escapeHtml(desire.object)}`;
}

/** Two-pill stats line — primary station-type count + total station count. WAY's primary is its generational ship, so the line reads "Generational Ships: N · Stations: N". */
function statsHtml(nation: Nation, stationManager: StationManager): string {
  const primaryType = nation.primaryBuildableStationTypeId;
  const stationsForNation = stationManager.getStations().filter((station) => station.nation.id === nation.id);
  const totalCount = stationsForNation.length;
  const primaryCount = stationsForNation.filter((station) => station.stationType.id === primaryType).length;
  const primaryName = getStationTypeTemplate(primaryType).namePlural;
  return `${escapeHtml(primaryName)}: <span class="pill-cyan">${primaryCount}</span><span class="sep">·</span>Stations: <span class="pill-gold">${totalCount}</span>`;
}

/** Cooldown countdown row for WAY — shown when no generational ship is docked and no event is active. Two other states (event in progress, ship docked between events) are rendered by wayActivityHtml above this. */
function wayCountdownHtml(emigrationManager: EmigrationManager): string {
  const totalGap = emigrationManager.getPostJumpGapSeconds();
  const secondsRemaining = Math.ceil(emigrationManager.getSecondsUntilNextGenerationalShip());
  const progress = totalGap > 0 ? Math.max(0, Math.min(1, 1 - secondsRemaining / totalGap)) : 0;
  const percent = Math.floor(progress * 100);
  return `
    <div class="cargo-row">
      <span class="cargo-label">Generational ship status</span>
      <span class="cargo-track"><span class="cargo-fill" style="width: ${percent}%;"></span></span>
      <span class="cargo-stat">Arriving &middot; ${escapeHtml(formatHoursMinutesSeconds(secondsRemaining))}</span>
    </div>
  `;
}

function wayActivityHtml(emigrationManager: EmigrationManager): string {
  if (emigrationManager.getActiveEvent()) {
    return `
      <div class="cargo-note">
        <span class="cargo-note-label">Generational ship status</span>
        <div class="cargo-note-value">Emigration in progress</div>
      </div>
    `;
  }
  if (emigrationManager.getActiveGenerationalShip()) {
    return `
      <div class="cargo-note">
        <span class="cargo-note-label">Generational ship status</span>
        <div class="cargo-note-value">
          &bull; Crew enjoying shore leave<br>
          &bull; Waiting for emigration
        </div>
      </div>
    `;
  }
  return wayCountdownHtml(emigrationManager);
}

/** Build progress as 0–100% — averages provisions and hulls fill ratios against waresRequired. */
function buildProgressPercent(buildStation: Station): number {
  const build = buildStation.build!;
  const provisionsSlot = getInventorySlot(buildStation, "provisions");
  const hullsSlot = getInventorySlot(buildStation, "hulls");
  const provisionsProgress = provisionsSlot ? provisionsSlot.current / build.waresRequired.provisions : 0;
  const hullsProgress = hullsSlot ? hullsSlot.current / build.waresRequired.hulls : 0;
  return Math.floor(((provisionsProgress + hullsProgress) / 2) * 100);
}

interface BuildingActivityContext {
  nation: Nation;
  nationManager: NationManager;
  stationManager: StationManager;
  sectorNameByZoneId: Map<string, string>;
}

function buildingActivityHtml(context: BuildingActivityContext): string {
  const { nation, nationManager, stationManager, sectorNameByZoneId } = context;
  const currentBuildStationId = nationManager.getCurrentBuildStationId(nation.id);
  const buildStation = currentBuildStationId ? stationManager.getStation(currentBuildStationId) : null;
  if (!buildStation || !buildStation.build) {
    return `
      <div class="cargo-note">
        <span class="cargo-note-label">Expansion status</span>
        <div class="cargo-note-value cargo-note-dim">No eligible build sites</div>
      </div>
    `;
  }
  const build = buildStation.build;
  const percent = buildProgressPercent(buildStation);
  const zoneId = buildStation.zoneId;
  const sectorName = zoneId ? (sectorNameByZoneId.get(zoneId) ?? "—") : "—";
  const typeLabel = buildStation.stationType.name;
  const label = build.contractingNationId
    ? `Building via contract with ${build.contractingNationId.toUpperCase()}`
    : "Building station at";
  return `
    <div class="cargo-row">
      <span class="cargo-label">${escapeHtml(label)}</span>
      <span class="cargo-track"><span class="cargo-fill" style="width: ${percent}%;"></span></span>
      <span class="cargo-stat">${escapeHtml(sectorName)} &middot; ${escapeHtml(typeLabel)} &middot; ${percent}%</span>
    </div>
  `;
}
