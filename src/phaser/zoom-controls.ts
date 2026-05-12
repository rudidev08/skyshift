import { type Scene } from "phaser";
import { CircleMinus, CirclePlus } from "lucide-static";
import { setHtmlIfChanged } from "../ui-dom-cache";

export interface ZoomControlsConfig {
  /** Cycle targets for tap-on-level; first/last also bound the +/- buttons. */
  presets: number[];
  /** How far each +/- press moves the displayed 1–9 level. Defaults to 1.0
   *  (one whole digit per press); use a fraction for finer steps. */
  displayStep?: number;
  /** Defaults to 300ms. */
  animationDurationMs?: number;
  /** Element refs for the dial. When omitted, falls back to the page-global
   *  `#zoom-out`, `#zoom-level`, `#zoom-in` ids — the live game's pattern.
   *  Pass refs when more than one dial coexists in the DOM (e.g. the editor's
   *  Map and Timelapse tabs each owning their own copy). */
  elements?: {
    zoomOut: HTMLElement;
    zoomLevel: HTMLElement;
    zoomIn: HTMLElement;
  };
}

export interface ZoomControls {
  updateDisplay(): void;
  destroy(): void;
  setMinZoom(min: number): void;
}

const DOT_COUNT = 5;

export function setupZoomControls(
  scene: Scene,
  config: ZoomControlsConfig,
): ZoomControls {
  const presets = config.presets;
  const displayStep = config.displayStep ?? 1.0;
  const animationDurationMs = config.animationDurationMs ?? 300;
  let minZoom = presets[0];
  const maxZoom = presets[presets.length - 1];

  const camera = scene.cameras.main;
  const zoomLevelElement = config.elements?.zoomLevel ?? document.getElementById("zoom-level")!;
  const zoomOutButton = config.elements?.zoomOut ?? document.getElementById("zoom-out")!;
  const zoomInButton = config.elements?.zoomIn ?? document.getElementById("zoom-in")!;

  // Skip re-painting when icons are already there — the timelapse tab remounts
  // its scene on every Run, hitting the same DOM buttons each time.
  if (!zoomOutButton.firstChild) zoomOutButton.innerHTML = CircleMinus;
  if (!zoomInButton.firstChild) zoomInButton.innerHTML = CirclePlus;

  const updateDisplay = () => {
    const displayLevel = mapZoomToDisplayLevel(camera.zoom, minZoom, maxZoom);
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

  // Display level spans 1→9 (8 increments), so one display unit = range/8 in
  // internal zoom. Snap to that grid anchored at minZoom so consecutive +/-
  // presses are reversible even when the camera starts off-grid (e.g. after a
  // wheel zoom or a preset cycle landed on an arbitrary value).
  const stepZoom = (direction: 1 | -1) => {
    const internalStep = ((maxZoom - minZoom) / 8) * displayStep;
    const offGrid = camera.zoom + direction * internalStep - minZoom;
    const target = minZoom + Math.round(offGrid / internalStep) * internalStep;
    animateZoom(Math.min(maxZoom, Math.max(minZoom, target)));
  };
  const onZoomOut = () => stepZoom(-1);
  const onZoomIn = () => stepZoom(1);
  const onCyclePreset = () => {
    const next =
      presets.find((preset) => preset > camera.zoom + 0.05) ?? presets[0];
    animateZoom(next);
  };

  zoomOutButton.addEventListener("click", onZoomOut);
  zoomInButton.addEventListener("click", onZoomIn);
  zoomLevelElement.addEventListener("click", onCyclePreset);

  return {
    updateDisplay,
    setMinZoom(min: number) {
      minZoom = min;
    },
    destroy() {
      zoomOutButton.removeEventListener("click", onZoomOut);
      zoomInButton.removeEventListener("click", onZoomIn);
      zoomLevelElement.removeEventListener("click", onCyclePreset);
    },
  };
}

/** Maps internal zoom (continuous float between minZoom and maxZoom) to a
 *  1.0–9.0 display level with one decimal. Internal zoom math is unaffected;
 *  this is purely presentation so the user sees "5.7" instead of "0.4×". */
function mapZoomToDisplayLevel(currentZoom: number, minZoom: number, maxZoom: number): string {
  const range = Math.max(0.0001, maxZoom - minZoom);
  const progress = Math.min(1, Math.max(0, (currentZoom - minZoom) / range));
  const level = 1 + progress * 8;
  return Math.min(9, Math.max(1, level)).toFixed(1);
}

/** Range indicator below the zoom digit — DOT_COUNT positions evenly spaced from min→max zoom, closest lit. Not a preset switcher (presets aren't evenly spaced). */
function buildZoomRangeDotsHtml(currentZoom: number, minZoom: number, maxZoom: number): string {
  // Clamp guards divide-by-zero when minZoom == maxZoom — reachable when the
  // timelapse viewport is large enough that fitZoom is the only surviving preset.
  const span = Math.max(0.0001, maxZoom - minZoom);
  const zoomProgress = Math.min(1, Math.max(0, (currentZoom - minZoom) / span));
  const activeDotIndex = Math.round(zoomProgress * (DOT_COUNT - 1));
  let html = "";
  for (let i = 0; i < DOT_COUNT; i++) {
    html += `<span class="dot${i === activeDotIndex ? " on" : ""}"></span>`;
  }
  return html;
}
