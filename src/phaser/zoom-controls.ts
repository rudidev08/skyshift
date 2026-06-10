import { type Scene } from "phaser";
import { CircleMinus, CirclePlus } from "lucide-static";
import { setHtmlIfChanged } from "../ui-dom-cache";
import { clamped01Fraction } from "../util-clamp";
import {
  cameraZoomLevelMin,
  cameraZoomLevelSpan,
  cameraZoomLevelStops,
  zoomDialDotCount,
  zoomAnimationDurationMilliseconds,
  zoomStopReselectMargin,
} from "../../data/controls-camera";

export interface ZoomControlsConfig {
  /** Internal Phaser camera.zoom that maps to display level 1.0 (most zoomed out). Overview mode lowers this via setMinPhaserZoom. */
  minPhaserZoom: number;
  /** Internal Phaser camera.zoom that maps to display level 9.0 (most zoomed in). */
  maxPhaserZoom: number;
}

export interface ZoomControls {
  updateDisplay(): void;
  destroy(): void;
  setMinPhaserZoom(minPhaserZoom: number): void;
}

export function setupZoomControls(scene: Scene, config: ZoomControlsConfig): ZoomControls {
  let minPhaserZoom = config.minPhaserZoom;
  const maxPhaserZoom = config.maxPhaserZoom;

  const camera = scene.cameras.main;
  const zoomLevelElement = document.getElementById("zoom-level")!;
  const zoomOutButton = document.getElementById("zoom-out")!;
  const zoomInButton = document.getElementById("zoom-in")!;
  paintZoomButtonIcons(zoomOutButton, zoomInButton);

  const updateDisplay = () => {
    const displayLevel = internalZoomToDisplayLevel(camera.zoom, minPhaserZoom, maxPhaserZoom).toFixed(1);
    const dotsHtml = buildZoomRangeDotsHtml(camera.zoom, minPhaserZoom, maxPhaserZoom);
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
      duration: zoomAnimationDurationMilliseconds,
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
    const next = nextZoomStopUp(internalZoomToDisplayLevel(camera.zoom, minPhaserZoom, maxPhaserZoom));
    if (next !== undefined) animateZoom(displayLevelToInternalZoom(next, minPhaserZoom, maxPhaserZoom));
  };
  const stepZoomOut = () => {
    const previous = nextZoomStopDown(internalZoomToDisplayLevel(camera.zoom, minPhaserZoom, maxPhaserZoom));
    if (previous !== undefined) animateZoom(displayLevelToInternalZoom(previous, minPhaserZoom, maxPhaserZoom));
  };
  const onCycleStop = () => {
    const next =
      nextZoomStopUp(internalZoomToDisplayLevel(camera.zoom, minPhaserZoom, maxPhaserZoom)) ??
      cameraZoomLevelStops[0];
    animateZoom(displayLevelToInternalZoom(next, minPhaserZoom, maxPhaserZoom));
  };

  zoomOutButton.addEventListener("click", stepZoomOut);
  zoomInButton.addEventListener("click", stepZoomIn);
  zoomLevelElement.addEventListener("click", onCycleStop);

  return {
    updateDisplay,
    setMinPhaserZoom(nextMinPhaserZoom: number) {
      minPhaserZoom = nextMinPhaserZoom;
      // View-mode changes swap the zoom floor (overview ↔ normal), which
      // changes the display-level mapping — repaint so the HUD doesn't show
      // a stale level until the next zoom input.
      updateDisplay();
    },
    destroy() {
      zoomOutButton.removeEventListener("click", stepZoomOut);
      zoomInButton.removeEventListener("click", stepZoomIn);
      zoomLevelElement.removeEventListener("click", onCycleStop);
    },
  };
}

function paintZoomButtonIcons(zoomOut: HTMLElement, zoomIn: HTMLElement): void {
  // Skip re-painting when icons are already there — Game-scene remounts (the
  // editor's map tab after edits, loading a save from settings) reuse the
  // same DOM buttons.
  if (!zoomOut.firstChild) zoomOut.innerHTML = CircleMinus;
  if (!zoomIn.firstChild) zoomIn.innerHTML = CirclePlus;
}

/** Clamped 0–1 position of `currentZoom` within [minPhaserZoom, maxPhaserZoom]. The
 *  0.0001 floor guards divide-by-zero when minPhaserZoom === maxPhaserZoom. */
function clampedZoomProgress(currentZoom: number, minPhaserZoom: number, maxPhaserZoom: number): number {
  const range = Math.max(0.0001, maxPhaserZoom - minPhaserZoom);
  return clamped01Fraction(currentZoom, minPhaserZoom, minPhaserZoom + range);
}

/** Converts Phaser's raw camera.zoom to the 1.0–9.0 level shown to the user.
 *  Purely presentation — the camera zoom value is never written here. */
function internalZoomToDisplayLevel(currentZoom: number, minPhaserZoom: number, maxPhaserZoom: number): number {
  return cameraZoomLevelMin + clampedZoomProgress(currentZoom, minPhaserZoom, maxPhaserZoom) * cameraZoomLevelSpan;
}

/** The Phaser camera.zoom value that corresponds to a given 1.0–9.0 display level. */
function displayLevelToInternalZoom(level: number, minPhaserZoom: number, maxPhaserZoom: number): number {
  const progress = (level - cameraZoomLevelMin) / cameraZoomLevelSpan;
  return minPhaserZoom + progress * (maxPhaserZoom - minPhaserZoom);
}

/** Next zoom stop above `currentLevel` (display-level space). The margin
 *  prevents a press while sitting just past a stop from snapping back to it. */
function nextZoomStopUp(currentLevel: number): number | undefined {
  return cameraZoomLevelStops.find((stop) => stop > currentLevel + zoomStopReselectMargin);
}

/** Next zoom stop strictly below `currentLevel` (display-level space). */
function nextZoomStopDown(currentLevel: number): number | undefined {
  return [...cameraZoomLevelStops].reverse().find((stop) => stop < currentLevel - zoomStopReselectMargin);
}

/** Range indicator below the zoom digit — evenly spaced positions from min→max zoom, closest lit. Not a stop switcher (the +/- stops aren't evenly spaced). */
function buildZoomRangeDotsHtml(currentZoom: number, minPhaserZoom: number, maxPhaserZoom: number): string {
  const activeDotIndex = Math.round(
    clampedZoomProgress(currentZoom, minPhaserZoom, maxPhaserZoom) * (zoomDialDotCount - 1),
  );
  let html = "";
  for (let i = 0; i < zoomDialDotCount; i++) {
    html += `<span class="dot${i === activeDotIndex ? " on" : ""}"></span>`;
  }
  return html;
}
