import { test, assertEqual, assertTrue } from "./test-utils.ts";
import { shouldRefreshSelectionHud } from "../ui-game-hud.ts";

// The selection/sector HUD card shows the selected entity, or — when nothing
// is selected — the sector under the camera center. Entity data changes with
// the sim, so it's rate-limited by the per-tick throttle. The sector is a
// pure function of camera position, independent of the sim.

test("paused + nothing selected + camera pans to a new sector → HUD refreshes", () => {
  // While paused no sim tick elapses, so the per-tick throttle never fires.
  // Nothing is selected, so the card is the sector card; the camera crossed a
  // sector boundary. The card must re-render to show the new sector.
  const refresh = shouldRefreshSelectionHud({
    selectionChanged: false,
    detailsPanelJustOpened: false,
    tickThrottleElapsed: false,
    showingSectorCard: true,
    sectorChanged: true,
  });
  assertTrue(refresh, "sector card must refresh on sector change even while paused");
});

test("paused + nothing selected + camera stays in the same sector → no refresh", () => {
  // Nothing changed and the throttle hasn't fired — re-rendering every paused
  // frame would be wasted DOM work.
  const refresh = shouldRefreshSelectionHud({
    selectionChanged: false,
    detailsPanelJustOpened: false,
    tickThrottleElapsed: false,
    showingSectorCard: true,
    sectorChanged: false,
  });
  assertEqual(refresh, false, "no refresh when nothing changed and the throttle hasn't fired");
});

test("paused + an entity selected + camera pans to a new sector → no refresh", () => {
  // With an entity selected the card shows that entity, not the sector. The
  // entity is frozen while paused, so a sector change must not force a refresh.
  const refresh = shouldRefreshSelectionHud({
    selectionChanged: false,
    detailsPanelJustOpened: false,
    tickThrottleElapsed: false,
    showingSectorCard: false,
    sectorChanged: true,
  });
  assertEqual(refresh, false, "selected entity card stays frozen while paused as the camera pans");
});

test("the original triggers still force a refresh", () => {
  // Selection change, details-panel opening, and the per-tick throttle each
  // independently force a refresh (regression guard for the pre-fix behavior).
  assertTrue(
    shouldRefreshSelectionHud({
      selectionChanged: true,
      detailsPanelJustOpened: false,
      tickThrottleElapsed: false,
      showingSectorCard: false,
      sectorChanged: false,
    }),
    "selection change forces a refresh",
  );
  assertTrue(
    shouldRefreshSelectionHud({
      selectionChanged: false,
      detailsPanelJustOpened: true,
      tickThrottleElapsed: false,
      showingSectorCard: false,
      sectorChanged: false,
    }),
    "details panel opening forces a refresh",
  );
  assertTrue(
    shouldRefreshSelectionHud({
      selectionChanged: false,
      detailsPanelJustOpened: false,
      tickThrottleElapsed: true,
      showingSectorCard: false,
      sectorChanged: false,
    }),
    "per-tick throttle forces a refresh",
  );
});
