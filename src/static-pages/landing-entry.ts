import { mountPageBackground } from "./background";
import { mountSectorAnimation } from "./sector-scene-2d";
import {
  ICON_ARCHIVES,
  ICON_FARM,
  ICON_MINE,
  NATION_COLORS,
  HULL_JUMPSHIP,
  HULL_SEEDHAUL,
  HULL_TANKER,
} from "./scene-presets";
import { morseBarGradient } from "../render-morse-bar";
import { findLatestSave } from "../storage-save-slots";
import { formatLocalDateTime } from "../util-date-format";
import { presetsForLandingPage } from "../util-map-preset";
import type { MapPreset } from "../../data/map-types";

// Featured preset on first visit — gold .is-on treatment, sorts leftmost.
const RECOMMENDED_PRESET_ID = "settled";

function renderFirstVisit(root: HTMLElement, presets: readonly MapPreset[]): void {
  const buttons = presets
    .map((preset) => {
      const isRecommended = preset.id === RECOMMENDED_PRESET_ID;
      return `
        <button type="button"
                class="hud-btn start-btn start-btn--morse${isRecommended ? " is-on" : ""}"
                data-action="new" data-preset="${preset.id}" data-morse-name="${preset.name}">
          <span class="start-btn-sub">Enter universe</span>
          <span class="start-btn-title">${preset.name}</span>
          <span class="start-btn-note">${preset.description}</span>
        </button>
      `;
    })
    .join("");
  root.innerHTML = `<div class="start-primary-row">${buttons}</div>`;
}

function renderContinue(
  root: HTMLElement,
  presets: readonly MapPreset[],
  latestSavedAt: number,
): void {
  // Stripe encodes "Continue" so the CTA reads as resume, not as a per-preset choice.
  const { date, time } = formatLocalDateTime(new Date(latestSavedAt));
  const subactions = presets
    .map((preset) => `
      <button type="button" class="hud-btn" data-action="new" data-preset="${preset.id}">
        Start new ${preset.name} universe
      </button>
    `)
    .join("");
  root.innerHTML = `
    <button type="button" class="hud-btn is-on start-btn start-continue start-btn--morse"
            data-action="continue" data-morse-name="Continue">
      <span class="start-btn-title">Continue saved</span>
      <span class="continue-date">${date} ${time}</span>
    </button>
    <div class="start-subactions">${subactions}</div>
  `;
}

function paintMorseStripes(root: HTMLElement): void {
  for (const button of root.querySelectorAll<HTMLElement>(".start-btn--morse")) {
    const name = button.dataset.morseName ?? "";
    button.style.setProperty("--morse-bar", morseBarGradient(name));
  }
}

function wireClicks(root: HTMLElement): void {
  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>("[data-action]");
    if (!button || button.disabled) return;
    if (button.dataset.action === "continue") {
      window.location.href = "/universe";
      return;
    }
    const preset = button.dataset.preset;
    if (!preset) return;
    window.location.href = `/start/${preset}`;
  });
}

function mountStartActions(root: HTMLElement): void {
  const presets = [...presetsForLandingPage()].sort((left, right) => {
    if (left.id === RECOMMENDED_PRESET_ID) return -1;
    if (right.id === RECOMMENDED_PRESET_ID) return 1;
    return 0;
  });

  // Slots are shared across presets — Continue routes to /universe and
  // game-entry loads the most recent slot from localStorage.
  const latestSave = findLatestSave();

  if (latestSave && latestSave.savedAt !== null) {
    renderContinue(root, presets, latestSave.savedAt);
  } else {
    renderFirstVisit(root, presets);
  }

  paintMorseStripes(root);
  wireClicks(root);
}

const startActionsRoot = document.querySelector<HTMLElement>('[data-role="start-actions"]');
if (startActionsRoot) mountStartActions(startActionsRoot);

const backgroundCanvas = document.getElementById("bg");
if (backgroundCanvas instanceof HTMLCanvasElement) {
  mountPageBackground(backgroundCanvas);
}

const sectorCanvas = document.getElementById("sector");
if (sectorCanvas instanceof HTMLCanvasElement) {
  mountSectorAnimation(sectorCanvas, {
    stations: [
      { id: "sky", xRatio: 0.22, yRatio: 0.50, color: NATION_COLORS.sky, iconSvgInner: ICON_ARCHIVES, label: "Drifthollow", twinkleCount: 9 },
      { id: "bio", xRatio: 0.68, yRatio: 0.34, color: NATION_COLORS.bio, iconSvgInner: ICON_FARM,     label: "Bloomreach",  twinkleCount: 6 },
      { id: "ore", xRatio: 0.78, yRatio: 0.68, color: NATION_COLORS.ore, iconSvgInner: ICON_MINE,     label: "Ironvein",    twinkleCount: 3 },
    ],
    flights: [
      { startStationId: "sky", color: NATION_COLORS.sky, ship: HULL_JUMPSHIP },
      { startStationId: "bio", color: NATION_COLORS.bio, ship: HULL_SEEDHAUL },
      { startStationId: "ore", color: NATION_COLORS.ore, ship: HULL_TANKER },
    ],
    nebulas: [
      { src: "/index/nebula-skyshift.png", xRatio: 0.22, yRatio: 0.50, sizeFraction: 0.70, alpha: 0.5 },
      { src: "/index/nebula-void1.png",    xRatio: 0.73, yRatio: 0.51, sizeFraction: 0.65, alpha: 1.0 },
      { src: "/index/nebula-void2.png",    xRatio: 0.55, yRatio: 0.69, sizeFraction: 0.55, alpha: 1.0, rotationDegrees: -160 },
    ],
  });
}
