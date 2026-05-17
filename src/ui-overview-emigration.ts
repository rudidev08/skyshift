/** Emigration tab in the overview sidebar — mode toggle (auto/manual), intensity selector (25/50/75%), manual trigger, and "next generational ship in…" countdown. */

import type { EmigrationManager } from "./sim-emigration-manager";
import type { EmigrationTriggerMode, EmigrationIntensity } from "./sim-emigration-types";
import { morseBarGradient } from "./render-morse-bar";
import { formatHoursMinutesSeconds } from "./render-elapsed-time-label";
import { showToast } from "./ui-toast";
import { setTextIfChanged } from "./ui-dom-cache";

/** Per-tick `update()` and teardown handle returned by `createEmigrationControls`. */
export interface EmigrationControls {
  update(): void;
  destroy(): void;
}

interface EmigrationElements {
  modeButtons: NodeListOf<HTMLButtonElement>;
  intensityButtons: NodeListOf<HTMLButtonElement>;
  triggerSection: HTMLElement;
  triggerButton: HTMLButtonElement;
  modeDescription: HTMLElement;
  eligibilityLabel: HTMLElement;
  arrivalSection: HTMLElement;
}

const MODE_DESCRIPTION: Record<EmigrationTriggerMode, string> = {
  auto: "Emigration triggers automatically once a vast majority of sectors are populated.",
  manual: "Emigration only triggers when you start it yourself.",
};

// One-off button — kept inline rather than extracted to ui.css.
const TRIGGER_BUTTON_STYLE =
  "width: 100%; justify-content: center; font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase;";

/** Mount the emigration sidebar into `root` and return a controls handle for per-tick refresh and teardown. */
export function createEmigrationControls(
  root: HTMLElement,
  emigrationManager: EmigrationManager,
): EmigrationControls {
  const sidebar = buildEmigrationSidebar(root);
  const elements = findEmigrationElements(sidebar);
  const refresh = (): void => refreshEmigrationView(elements, emigrationManager);
  attachModeButtonHandlers(elements.modeButtons, emigrationManager, refresh);
  attachIntensityButtonHandlers(elements.intensityButtons, emigrationManager, refresh);
  attachTriggerButtonHandler(elements.triggerButton, emigrationManager, refresh);
  refresh();

  return {
    update: refresh,
    destroy: () => {
      root.innerHTML = "";
    },
  };
}

function buildEmigrationSidebar(root: HTMLElement): HTMLElement {
  root.innerHTML = "";
  const sidebar = document.createElement("div");
  sidebar.className = "ware-sidebar";
  sidebar.style.setProperty(
    "--morse-bar",
    morseBarGradient("Emigration", { letterCount: 3, color: "var(--paper-mute)" }),
  );
  root.appendChild(sidebar);

  sidebar.innerHTML = `
    <div class="ware-sidebar-head">Emigration</div>
    <div class="ware-sidebar-blurb">Stations send their crew to the generational ship, which emigrates beyond the charts — freeing sectors for new settlement.</div>
    <div class="ware-section">
      <div class="ware-section-label ware-section-label--settings">» Mode</div>
      <div class="hud-segment hud-segment--row">
        <button data-action="set-mode" data-value="auto" class="hud-btn">Auto</button>
        <button data-action="set-mode" data-value="manual" class="hud-btn">Manual</button>
      </div>
      <div class="description-text-dim" data-role="mode-description"></div>
    </div>
    <div class="ware-section">
      <div class="ware-section-label ware-section-label--settings">» Share</div>
      <div class="hud-segment hud-segment--row">
        <button data-action="set-intensity" data-value="low" class="hud-btn">25%</button>
        <button data-action="set-intensity" data-value="medium" class="hud-btn">50%</button>
        <button data-action="set-intensity" data-value="high" class="hud-btn">75%</button>
      </div>
      <div class="description-text-dim">Percentage of stations that will start emigrating out of the cluster.</div>
    </div>
    <div class="ware-section" data-role="trigger-section" hidden>
      <div class="ware-section-label ware-section-label--settings">» Trigger</div>
      <button data-action="trigger" class="hud-btn" style="${TRIGGER_BUTTON_STYLE}">Start emigration</button>
      <div class="description-text-dim" data-role="eligibility"></div>
    </div>
    <div class="ware-section" data-role="arrival-section" style="font-family: var(--font-mono); font-size: 11px; color: var(--paper-dim);" hidden></div>
  `;

  return sidebar;
}

function findEmigrationElements(sidebar: HTMLElement): EmigrationElements {
  return {
    modeButtons: sidebar.querySelectorAll<HTMLButtonElement>("[data-action='set-mode']"),
    intensityButtons: sidebar.querySelectorAll<HTMLButtonElement>("[data-action='set-intensity']"),
    triggerSection: sidebar.querySelector<HTMLElement>("[data-role='trigger-section']")!,
    triggerButton: sidebar.querySelector<HTMLButtonElement>("[data-action='trigger']")!,
    modeDescription: sidebar.querySelector<HTMLElement>("[data-role='mode-description']")!,
    eligibilityLabel: sidebar.querySelector<HTMLElement>("[data-role='eligibility']")!,
    arrivalSection: sidebar.querySelector<HTMLElement>("[data-role='arrival-section']")!,
  };
}

function attachModeButtonHandlers(
  modeButtons: NodeListOf<HTMLButtonElement>,
  emigrationManager: EmigrationManager,
  refresh: () => void,
): void {
  for (const button of modeButtons) {
    button.addEventListener("click", () => {
      const value = button.getAttribute("data-value");
      if (value === "auto" || value === "manual") emigrationManager.setMode(value);
      refresh();
    });
  }
}

function attachIntensityButtonHandlers(
  intensityButtons: NodeListOf<HTMLButtonElement>,
  emigrationManager: EmigrationManager,
  refresh: () => void,
): void {
  for (const button of intensityButtons) {
    button.addEventListener("click", () => {
      const value = button.getAttribute("data-value");
      if (value === "low" || value === "medium" || value === "high") emigrationManager.setIntensity(value);
      refresh();
    });
  }
}

function attachTriggerButtonHandler(
  triggerButton: HTMLButtonElement,
  emigrationManager: EmigrationManager,
  refresh: () => void,
): void {
  triggerButton.addEventListener("click", () => {
    if (triggerButton.disabled) return;
    emigrationManager.manualTrigger();
    const toast = emigrationManager.takePendingToast();
    if (toast) showToast(toast);
    refresh();
  });
}

function refreshEmigrationView(elements: EmigrationElements, emigrationManager: EmigrationManager): void {
  refreshModeSegment(elements, emigrationManager);
  refreshTriggerSection(elements, emigrationManager);
  refreshArrivalCountdown(elements, emigrationManager);
}

function refreshModeSegment(elements: EmigrationElements, emigrationManager: EmigrationManager): void {
  const mode: EmigrationTriggerMode = emigrationManager.getMode();
  const intensity: EmigrationIntensity = emigrationManager.getIntensity();
  for (const button of elements.modeButtons) {
    button.classList.toggle("is-on", button.getAttribute("data-value") === mode);
  }
  for (const button of elements.intensityButtons) {
    button.classList.toggle("is-on", button.getAttribute("data-value") === intensity);
  }
  setTextIfChanged(elements.modeDescription, MODE_DESCRIPTION[mode]);
}

function refreshTriggerSection(elements: EmigrationElements, emigrationManager: EmigrationManager): void {
  const isManualMode = emigrationManager.getMode() === "manual";
  elements.triggerSection.hidden = !isManualMode;
  if (!isManualMode) return;
  const eligibleCount = emigrationManager.countEligibleStations();
  const triggerEnabled = emigrationManager.canManualTrigger() && eligibleCount > 0;
  elements.triggerButton.disabled = !triggerEnabled;
  elements.triggerButton.classList.toggle("is-on", triggerEnabled);
  setTextIfChanged(
    elements.eligibilityLabel,
    eligibleCount > 0
      ? `${eligibleCount} station${eligibleCount === 1 ? "" : "s"} eligible`
      : "No stations eligible",
  );
}

function refreshArrivalCountdown(elements: EmigrationElements, emigrationManager: EmigrationManager): void {
  const secondsUntilArrival = Math.ceil(emigrationManager.getSecondsUntilNextGenerationalShip());
  if (secondsUntilArrival > 0) {
    elements.arrivalSection.hidden = false;
    setTextIfChanged(
      elements.arrivalSection,
      `Next generational ship arriving in ${formatHoursMinutesSeconds(secondsUntilArrival)}`,
    );
  } else {
    elements.arrivalSection.hidden = true;
  }
}
