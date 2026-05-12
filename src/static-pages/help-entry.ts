/* Entry for help.html — starfield background, three mini sector scenes
 * (one per game-flow step), and Lucide icons in the HUD help cards. */

import {
  Book,
  CircleChevronUp,
  CircleDashed,
  CircleMinus,
  CirclePlus,
  Cuboid,
  FastForward,
  Logs,
  Settings,
} from "lucide-static";

import { mountPageBackground } from "./background";
import { mountSectorAnimation, type SectorScene } from "./sector-scene-2d";
import {
  HULL_SEEDHAUL,
  HULL_TANKER,
  HULL_TRADER,
  ICON_FARM,
  ICON_FORGE,
  ICON_GENERATIONAL_SHIP,
  ICON_MINE,
  ICON_TECH,
  NATION_COLORS,
} from "./scene-presets";

// Bright nebulas — dark-void variants don't show up under the "lighter"
// composite, so pick colorful ones (the game's own PNGs).
import nebulaSkyshift  from "../assets/backgrounds/nebula-skyshift.png";
import nebulaCore      from "../assets/backgrounds/nebula-core.png";
import nebulaMining    from "../assets/backgrounds/nebula-mining.png";
import nebulaPurple1   from "../assets/backgrounds/nebula-purple1.png";
import nebulaPurple2   from "../assets/backgrounds/nebula-purple2.png";
import nebulaDust1     from "../assets/backgrounds/nebula-dust1.png";

type HelpSceneName = "trade" | "build" | "emigrate";

const scenes: Record<HelpSceneName, SectorScene> = {
  // Three nations, criss-crossing routes — "what they have for what they need."
  trade: {
    stations: [
      { id: "bio", xRatio: 0.20, yRatio: 0.30, color: NATION_COLORS.bio, iconSvgInner: ICON_FARM, label: "Farm",  twinkleCount: 6 },
      { id: "ore", xRatio: 0.80, yRatio: 0.30, color: NATION_COLORS.ore, iconSvgInner: ICON_MINE, label: "Mine",  twinkleCount: 4 },
      { id: "hub", xRatio: 0.50, yRatio: 0.68, color: NATION_COLORS.hub, iconSvgInner: ICON_TECH, label: "Forge", twinkleCount: 5 },
    ],
    flights: [
      { startStationId: "bio", color: NATION_COLORS.bio, ship: HULL_SEEDHAUL },
      { startStationId: "ore", color: NATION_COLORS.ore, ship: HULL_TANKER },
      { startStationId: "hub", color: NATION_COLORS.hub, ship: HULL_TRADER },
    ],
    nebulas: [
      { src: nebulaSkyshift, xRatio: 0.48, yRatio: 0.50, sizeFraction: 0.95, alpha: 0.55 },
      { src: nebulaPurple1,  xRatio: 0.20, yRatio: 0.72, sizeFraction: 0.55, alpha: 0.55 },
    ],
  },

  // A HUB tech-factory contracts a new metal forge. Distinct icons keep
  // parent and new-site visually apart; two HUB traders shuttle hulls.
  build: {
    stations: [
      { id: "hub",  xRatio: 0.22, yRatio: 0.48, color: NATION_COLORS.hub, iconSvgInner: ICON_TECH,  label: "Factory",  twinkleCount: 6 },
      { id: "site", xRatio: 0.78, yRatio: 0.48, color: NATION_COLORS.hub, iconSvgInner: ICON_FORGE, label: "New site", twinkleCount: 2 },
    ],
    flights: [
      { startStationId: "hub",  color: NATION_COLORS.hub, ship: HULL_TRADER, loopStationIds: ["hub", "site"] },
      { startStationId: "site", color: NATION_COLORS.hub, ship: HULL_TRADER, loopStationIds: ["hub", "site"] },
    ],
    nebulas: [
      { src: nebulaCore,   xRatio: 0.52, yRatio: 0.50, sizeFraction: 0.90, alpha: 0.50 },
      { src: nebulaMining, xRatio: 0.78, yRatio: 0.60, sizeFraction: 0.60, alpha: 0.45 },
      { src: nebulaDust1,  xRatio: 0.22, yRatio: 0.40, sizeFraction: 0.55, alpha: 0.55 },
    ],
  },

  // A WAY generational ship hangs mid-sector while two stations ferry their
  // population aboard. Mirrors the sim's fly-to-generational-ship behavior.
  emigrate: {
    stations: [
      { id: "farm", xRatio: 0.18, yRatio: 0.30, color: NATION_COLORS.bio, iconSvgInner: ICON_FARM,    label: "Farm",              twinkleCount: 6 },
      { id: "way",  xRatio: 0.50, yRatio: 0.50, color: NATION_COLORS.way, iconSvgInner: ICON_GENERATIONAL_SHIP, label: "Generational Ship", twinkleCount: 4 },
      { id: "ore",  xRatio: 0.82, yRatio: 0.72, color: NATION_COLORS.ore, iconSvgInner: ICON_MINE,    label: "Mine",              twinkleCount: 4 },
    ],
    flights: [
      { startStationId: "farm", color: NATION_COLORS.bio, ship: HULL_SEEDHAUL, loopStationIds: ["farm", "way"] },
      { startStationId: "ore",  color: NATION_COLORS.ore, ship: HULL_TANKER,   loopStationIds: ["ore",  "way"] },
    ],
    nebulas: [
      { src: nebulaPurple2, xRatio: 0.50, yRatio: 0.50, sizeFraction: 0.95, alpha: 0.65 },
      { src: nebulaPurple1, xRatio: 0.20, yRatio: 0.30, sizeFraction: 0.55, alpha: 0.55 },
      { src: nebulaSkyshift, xRatio: 0.78, yRatio: 0.70, sizeFraction: 0.55, alpha: 0.40 },
    ],
  },
};

// Same Lucide glyphs the game injects into the HUD — keeps help in sync.
const hudIconHtmlByKey: Record<string, string> = {
  zoom:     CirclePlus + CircleMinus,
  controls: CircleChevronUp,
  speed:    FastForward,
  overview: Cuboid,
  zones:    CircleDashed,
  settings: Settings,
  log:      Logs,
  lore:     Book,
};

function isSceneName(name: string): name is HelpSceneName {
  return name in scenes;
}

function wireSceneCanvases(): void {
  for (const canvas of document.querySelectorAll<HTMLCanvasElement>("canvas[data-scene]")) {
    const name = canvas.dataset.scene ?? "";
    if (!isSceneName(name)) continue;
    mountSectorAnimation(canvas, scenes[name]);
  }
}

function wireHudIcons(): void {
  for (const element of document.querySelectorAll<HTMLElement>("[data-icon]")) {
    const key = element.dataset.icon ?? "";
    const html = hudIconHtmlByKey[key];
    if (html) element.innerHTML = html;
  }
}

const backgroundCanvas = document.getElementById("bg");
if (backgroundCanvas instanceof HTMLCanvasElement) mountPageBackground(backgroundCanvas);
wireSceneCanvases();
wireHudIcons();
