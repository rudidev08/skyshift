import { type Scene } from "phaser";
import { CircleMinus, CirclePlus } from "lucide-static";
import { setHtmlIfChanged } from "../ui-dom-cache";
import {
  cameraZoomLevelMin,
  cameraZoomLevelMax,
  cameraZoomLevelStops,
} from "../../data/controls-camera";

const zoomLevelRange = cameraZoomLevelMax - cameraZoomLevelMin;

export interface ZoomControlsConfig {
  /** Internal Phaser camera.zoom that maps to display level 1.0 (most zoomed out). Overview mode lowers this via setMinZoom. */
  minZoom: number;
  /** Internal Phaser camera.zoom that maps to display level 9.0 (most zoomed in). */
  maxZoom: number;
  /** Defaults to 300ms. */
  animationDurationMs?: number;
}

export interface ZoomControls {
  updateDisplay(): void;
  destroy(): void;
  setMinZoom(min: number): void;
}

const DOT_COUNT = 5;

export function setupZoomControls(scene: Scene, config: ZoomControlsConfig): ZoomControls {
  const animationDurationMs = config.animationDurationMs ?? 300;
  let minZoom = config.minZoom;
  const maxZoom = config.maxZoom;

  const camera = scene.cameras.main;
  const {
    zoomLevel: zoomLevelElement,
    zoomOut: zoomOutButton,
    zoomIn: zoomInButton,
  } = resolveZoomDomElements();
  paintZoomButtonIcons(zoomOutButton, zoomInButton);

  const updateDisplay = () => {
    const displayLevel = formatDisplayLevel(camera.zoom, minZoom, maxZoom);
    const dotsHtml = buildZoomRangeDotsHtml(camera.zoom, minZoom, maxZoom);
    setHtmlIfChanged(
      zoomLevelElement,
      `<span>${displayLevel}</span><span class="zoom-level-presets">${dotsHtml}</span>`,
    );
  };
  updateDisplay();

  const animateZoom = (target: number) => {
    scene.tweens.addCounter({
      from: camera.zoom,
      to: target,
      duration: animationDurationMs,
      ease: "Sine.easeInOut",
      onUpdate: (tween) => {
        camera.setZoom(tween.getValue() ?? target);
        updateDisplay();
      },
    });
  };

  // Step in display-level space (1.0–9.0) so +/- and tap behave the same
  // whether the camera sits on a stop or at an arbitrary wheel-zoom level.
  const stepZoomIn = () => {
    const next = nextZoomStopUp(internalZoomToDisplayLevel(camera.zoom, minZoom, maxZoom));
    if (next !== undefined) animateZoom(displayLevelToInternalZoom(next, minZoom, maxZoom));
  };
  const stepZoomOut = () => {
    const previous = nextZoomStopDown(internalZoomToDisplayLevel(camera.zoom, minZoom, maxZoom));
    if (previous !== undefined) animateZoom(displayLevelToInternalZoom(previous, minZoom, maxZoom));
  };
  const onCycleStop = () => {
    const next =
      nextZoomStopUp(internalZoomToDisplayLevel(camera.zoom, minZoom, maxZoom)) ??
      cameraZoomLevelStops[0];
    animateZoom(displayLevelToInternalZoom(next, minZoom, maxZoom));
  };

  zoomOutButton.addEventListener("click", stepZoomOut);
  zoomInButton.addEventListener("click", stepZoomIn);
  zoomLevelElement.addEventListener("click", onCycleStop);

  return {
    updateDisplay,
    setMinZoom(min: number) {
      minZoom = min;
    },
    destroy() {
      zoomOutButton.removeEventListener("click", stepZoomOut);
      zoomInButton.removeEventListener("click", stepZoomIn);
      zoomLevelElement.removeEventListener("click", onCycleStop);
    },
  };
}

function resolveZoomDomElements(): {
  zoomLevel: HTMLElement;
  zoomOut: HTMLElement;
  zoomIn: HTMLElement;
} {
  return {
    zoomLevel: document.getElementById("zoom-level")!,
    zoomOut: document.getElementById("zoom-out")!,
    zoomIn: document.getElementById("zoom-in")!,
  };
}

function paintZoomButtonIcons(zoomOut: HTMLElement, zoomIn: HTMLElement): void {
  // Skip re-painting when icons are already there — the timelapse tab remounts
  // its scene on every Run, hitting the same DOM buttons each time.
  if (!zoomOut.firstChild) zoomOut.innerHTML = CircleMinus;
  if (!zoomIn.firstChild) zoomIn.innerHTML = CirclePlus;
}

/** Clamped 0–1 position of `currentZoom` within [minZoom, maxZoom]. The
 *  0.0001 floor guards divide-by-zero when minZoom === maxZoom. */
function clampedZoomProgress(currentZoom: number, minZoom: number, maxZoom: number): number {
  const range = Math.max(0.0001, maxZoom - minZoom);
  return Math.min(1, Math.max(0, (currentZoom - minZoom) / range));
}

/** Maps internal zoom (continuous float between minZoom and maxZoom) to the
 *  cameraZoomLevelMin–cameraZoomLevelMax level. Internal zoom math is unaffected;
 *  this is purely presentation so the user sees "5.7" instead of "0.4×". */
function internalZoomToDisplayLevel(currentZoom: number, minZoom: number, maxZoom: number): number {
  return cameraZoomLevelMin + clampedZoomProgress(currentZoom, minZoom, maxZoom) * zoomLevelRange;
}

/** Inverse of internalZoomToDisplayLevel — the internal camera.zoom a display level lands on. */
function displayLevelToInternalZoom(level: number, minZoom: number, maxZoom: number): number {
  const progress = (level - cameraZoomLevelMin) / zoomLevelRange;
  return minZoom + progress * (maxZoom - minZoom);
}

/** Next zoom stop strictly above `currentLevel` (display-level space). The
 *  0.05 margin keeps a press off the current stop from re-selecting it. */
function nextZoomStopUp(currentLevel: number): number | undefined {
  return cameraZoomLevelStops.find((stop) => stop > currentLevel + 0.05);
}

/** Next zoom stop strictly below `currentLevel` (display-level space). */
function nextZoomStopDown(currentLevel: number): number | undefined {
  return [...cameraZoomLevelStops].reverse().find((stop) => stop < currentLevel - 0.05);
}

function formatDisplayLevel(currentZoom: number, minZoom: number, maxZoom: number): string {
  return internalZoomToDisplayLevel(currentZoom, minZoom, maxZoom).toFixed(1);
}

/** Range indicator below the zoom digit — DOT_COUNT positions evenly spaced from min→max zoom, closest lit. Not a stop switcher (the +/- stops aren't evenly spaced). */
function buildZoomRangeDotsHtml(currentZoom: number, minZoom: number, maxZoom: number): string {
  const activeDotIndex = Math.round(clampedZoomProgress(currentZoom, minZoom, maxZoom) * (DOT_COUNT - 1));
  let html = "";
  for (let i = 0; i < DOT_COUNT; i++) {
    html += `<span class="dot${i === activeDotIndex ? " on" : ""}"></span>`;
  }
  return html;
}
