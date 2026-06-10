import { test, assertEqual } from "./test-utils.ts";
import {
  StationZoneSelectionTarget,
  setStationZoneOccupied,
  updateStationZoneVisibility,
  updateStationZoneLabels,
  type StationZoneVisualBundle,
} from "../phaser/station-zone-render.ts";

// Pins the occupancy gate on zone visuals: a zone claimed mid-session by a
// live station (placeBuild) must hide its dashed "Unclaimed" icon + label and
// stop being selectable; emigration frees the zone and brings them back.
// Phaser game objects are stubbed — only the setVisible state matters.

// closeViewAlpha(1) is full label alpha — zoomed in past closeViewFadeEnd.
const CLOSE_ZOOM = 1;

function makeVisibilityStub() {
  return {
    visible: true,
    setVisible(value: boolean) {
      this.visible = value;
      return this;
    },
    setAlpha() {
      return this;
    },
  };
}

function makeZoneVisualBundle() {
  const image = makeVisibilityStub();
  const label = makeVisibilityStub();
  const visualBundle = {
    zone: { id: "alpha-1" },
    image,
    label,
    occupiedByStation: false,
  } as unknown as StationZoneVisualBundle;
  return { visualBundle, image, label };
}

test("claiming a zone hides its icon and label, and repaints don't re-show them", () => {
  const { visualBundle, image, label } = makeZoneVisualBundle();
  updateStationZoneVisibility([visualBundle], true);
  updateStationZoneLabels([visualBundle], CLOSE_ZOOM, true);
  assertEqual(image.visible, true, "preconditions: icon shown in zones view");
  assertEqual(label.visible, true, "preconditions: label shown at close zoom");

  setStationZoneOccupied(visualBundle, true, true);
  assertEqual(image.visible, false, "claimed zone icon hidden");
  assertEqual(label.visible, false, "claimed zone label hidden");

  // The view-mode repaint and the per-frame label fade both run while the
  // station is alive — neither may re-show a claimed zone.
  updateStationZoneVisibility([visualBundle], true);
  assertEqual(image.visible, false, "zones-view repaint keeps the claimed icon hidden");
  updateStationZoneLabels([visualBundle], CLOSE_ZOOM, true);
  assertEqual(label.visible, false, "per-frame label fade keeps the claimed label hidden");
});

test("freeing a claimed zone re-shows the icon in zones view; the label returns via the zoom fade", () => {
  const { visualBundle, image, label } = makeZoneVisualBundle();
  updateStationZoneVisibility([visualBundle], true);
  setStationZoneOccupied(visualBundle, true, true);

  setStationZoneOccupied(visualBundle, false, true);
  assertEqual(image.visible, true, "freed zone icon returns immediately in zones view");
  assertEqual(label.visible, false, "label waits for the per-frame zoom fade");
  updateStationZoneLabels([visualBundle], CLOSE_ZOOM, true);
  assertEqual(label.visible, true, "label fades back in at close zoom");
});

test("freeing a claimed zone outside zones view leaves everything hidden", () => {
  const { visualBundle, image, label } = makeZoneVisualBundle();
  updateStationZoneVisibility([visualBundle], false);
  setStationZoneOccupied(visualBundle, true, false);

  setStationZoneOccupied(visualBundle, false, false);
  assertEqual(image.visible, false, "icon stays hidden outside zones view");
  assertEqual(label.visible, false, "label stays hidden outside zones view");
});

test("a claimed zone is not selectable even in zones view; freeing restores selectability", () => {
  const { visualBundle } = makeZoneVisualBundle();
  const target = new StationZoneSelectionTarget(visualBundle, () => true);
  assertEqual(target.canSelect(), true, "unclaimed zone selectable in zones view");

  setStationZoneOccupied(visualBundle, true, true);
  assertEqual(target.canSelect(), false, "claimed zone not selectable");

  setStationZoneOccupied(visualBundle, false, true);
  assertEqual(target.canSelect(), true, "freed zone selectable again");
});
