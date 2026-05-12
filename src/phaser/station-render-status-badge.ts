// Small colored circle + glyph above the station body, flagging ware-level
// issues (warn / bad). Overview-mode only; "bad" pulses for attention. State
// lives on the parent StationVisualBundle so teardown stays centralized.

import type { StationVisualBundle } from "./station-visual-bundle";
import { Layer } from "./depth-layers";
import { statusBadgeVisuals } from "../../data/station-visuals";
import { DISPLAY_FONT_FAMILY } from "./viewport-culling";
import { getStationWareLevelHealth } from "../sim-station-health";
import type { GameViewMode } from "../game-view-mode";

export function hideStatusBadge(bundle: StationVisualBundle) {
  stopStatusBadgeTween(bundle);
  if (bundle.statusBadgeCircle) {
    bundle.statusBadgeCircle.setAlpha(1);
    bundle.statusBadgeCircle.setVisible(false);
  }
  if (bundle.statusBadgeText) {
    bundle.statusBadgeText.setAlpha(1);
    bundle.statusBadgeText.setVisible(false);
  }
  bundle.statusBadgeKind = undefined;
}

function stopStatusBadgeTween(bundle: StationVisualBundle) {
  if (!bundle.statusBadgeTween) return;
  bundle.statusBadgeTween.stop();
  bundle.statusBadgeTween.remove();
  bundle.statusBadgeTween = undefined;
}

function ensureStatusBadge(bundle: StationVisualBundle) {
  if (bundle.statusBadgeCircle && bundle.statusBadgeText) return;
  const scene = bundle.graphics.scene;
  const { x, y } = bundle.station;
  const badgeX = x + statusBadgeVisuals.offsetX;
  const badgeY = y + statusBadgeVisuals.offsetY;
  bundle.statusBadgeCircle = scene.add
    .circle(badgeX, badgeY, statusBadgeVisuals.radius, 0xffffff, 1)
    .setStrokeStyle(1, 0x000000, 0.6)
    .setDepth(Layer.StationLabel);
  bundle.statusBadgeText = scene.add
    .text(badgeX, badgeY, "", {
      fontFamily: DISPLAY_FONT_FAMILY,
      fontSize: "12px",
      fontStyle: "bold",
      color: "#ffffff",
    })
    .setOrigin(0.5, 0.5)
    .setResolution(3)
    .setDepth(Layer.StationSerial);
}

export function updateStationStatusBadge(bundle: StationVisualBundle, viewMode: GameViewMode) {
  if (viewMode !== "overview") {
    hideStatusBadge(bundle);
    return;
  }
  const state = getStationWareLevelHealth(bundle.station);
  if (state === "ok") {
    hideStatusBadge(bundle);
    return;
  }
  ensureStatusBadge(bundle);
  const circle = bundle.statusBadgeCircle!;
  const text = bundle.statusBadgeText!;
  const color = statusBadgeVisuals.colors[state];
  const glyph = statusBadgeVisuals.glyphs[state];

  if (bundle.statusBadgeKind !== state) {
    circle.setFillStyle(color);
    text.setText(glyph);
    bundle.statusBadgeKind = state;
  }
  circle.setVisible(true);
  text.setVisible(true);

  if (state === "bad") {
    // "warn" stays static so a sea of pulsing badges at overview zoom doesn't
    // drown out the urgent "bad" ones.
    if (!bundle.statusBadgeTween) {
      circle.setAlpha(1);
      text.setAlpha(1);
      bundle.statusBadgeTween = circle.scene.tweens.add({
        targets: [circle, text],
        alpha: 0.4,
        duration: statusBadgeVisuals.pulseDurationMilliseconds,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }
  } else {
    stopStatusBadgeTween(bundle);
    circle.setAlpha(1);
    text.setAlpha(1);
  }
}

export function destroyStatusBadge(bundle: StationVisualBundle) {
  stopStatusBadgeTween(bundle);
  bundle.statusBadgeCircle?.destroy();
  bundle.statusBadgeText?.destroy();
}
