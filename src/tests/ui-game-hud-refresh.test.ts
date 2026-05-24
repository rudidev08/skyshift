import { test, assertEqual, assertTrue } from "./test-utils.ts";
import { shouldRefreshSelectionHud, updateGameHud, type GameHudHost } from "../ui-game-hud.ts";

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
    logPanelJustOpened: false,
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
    logPanelJustOpened: false,
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
    logPanelJustOpened: false,
    tickThrottleElapsed: false,
    showingSectorCard: false,
    sectorChanged: true,
  });
  assertEqual(refresh, false, "selected entity card stays frozen while paused as the camera pans");
});

test("the original triggers still force a refresh", () => {
  // Selection change, log-panel opening, and the per-tick throttle each
  // independently force a refresh (regression guard for the pre-fix behavior).
  assertTrue(
    shouldRefreshSelectionHud({
      selectionChanged: true,
      logPanelJustOpened: false,
      tickThrottleElapsed: false,
      showingSectorCard: false,
      sectorChanged: false,
    }),
    "selection change forces a refresh",
  );
  assertTrue(
    shouldRefreshSelectionHud({
      selectionChanged: false,
      logPanelJustOpened: true,
      tickThrottleElapsed: false,
      showingSectorCard: false,
      sectorChanged: false,
    }),
    "log panel opening forces a refresh",
  );
  assertTrue(
    shouldRefreshSelectionHud({
      selectionChanged: false,
      logPanelJustOpened: false,
      tickThrottleElapsed: true,
      showingSectorCard: false,
      sectorChanged: false,
    }),
    "per-tick throttle forces a refresh",
  );
});

// --- SelectionTarget.getSelectedLabel() is a non-null contract ---
// Every real selection target (station / station-zone / ship) returns a
// SelectionLabel, never null; the no-selection case is handled by the
// optional chain on the *absent target*, not a null return. These tests pin
// that a present target's own label is written (never silently replaced by
// the sector fallback) and that a null-returning stub no longer type-checks.

interface FakeElement {
  innerHTML: string;
  textContent: string;
  hidden: boolean;
  style: {
    display: string;
    backgroundImage: string;
    setProperty(): void;
    removeProperty(): void;
  };
  classList: { toggle(): void };
  setAttribute(): void;
  dispatchEvent(): boolean;
}

function buildFakeElement(): FakeElement {
  return {
    innerHTML: "",
    textContent: "",
    hidden: false,
    style: { display: "none", backgroundImage: "", setProperty() {}, removeProperty() {} },
    classList: { toggle() {} },
    setAttribute() {},
    dispatchEvent: () => true,
  };
}

type HudSelectionTarget = NonNullable<GameHudHost["selection"]["selectedTarget"]>;
type SelectionLabelShape = ReturnType<HudSelectionTarget["getSelectedLabel"]>;

/** A complete-but-minimal SelectionTarget: every required member present so
 *  the mock satisfies the canonical interface, but only getSelectedLabel
 *  carries the test's label. updateGameHud reaches none of the others. */
function buildFakeSelectionTarget(getSelectedLabel: () => SelectionLabelShape): HudSelectionTarget {
  return {
    kind: "station",
    enterSelected() {},
    exitSelected() {},
    isActive: () => true,
    canSelect: () => true,
    getSelectedLabel,
    getMapPosition: () => null,
  };
}

function buildFakeHudHost(
  selectedTarget: HudSelectionTarget | null,
): { host: GameHudHost; elements: Record<string, FakeElement> } {
  const elements: Record<string, FakeElement> = {};
  const registerElement = (key: string): FakeElement => (elements[key] = buildFakeElement());
  const host = {
    selection: { interactive: true, selectedTarget },
    lastSelectionTarget: null,
    lastLogPanelOpen: false,
    lastHudTick: -1,
    lastHudSectorKey: "",
    lastIconUri: "",
    lastAccentColor: "",
    selectedObjectElement: registerElement("selectedObjectElement"),
    selectedTypeElement: registerElement("selectedTypeElement"),
    serialCodeElement: registerElement("serialCodeElement"),
    descriptionElement: registerElement("descriptionElement"),
    statusBandElement: registerElement("statusBandElement"),
    loreElement: registerElement("loreElement"),
    loreTitleElement: registerElement("loreTitleElement"),
    hudIconElement: registerElement("hudIconElement"),
    infoCardElement: registerElement("infoCardElement"),
    loreToggleElement: registerElement("loreToggleElement"),
    logToggleElement: registerElement("logToggleElement"),
    logContentElement: registerElement("logContentElement"),
    logBoxElement: registerElement("logBoxElement"),
    getSelectionTradeLog: () => "",
  } as unknown as GameHudHost;
  return { host, elements };
}

function installFakeCustomEvent(): void {
  (globalThis as { CustomEvent?: unknown }).CustomEvent = class {
    constructor(public type: string) {}
  };
}

test("updateGameHud writes a present target's own SelectionLabel (no sector fallback)", () => {
  installFakeCustomEvent();

  const label = {
    iconUri: "data:image/svg+xml,icon",
    stackLabel: "Station · Large",
    name: "Bloomreach",
    serialCode: "BIO-042",
    description: "<p>desc</p>",
    loreTypeName: "Station Type: Farm",
    lore: "A farm.",
    hasLog: false,
    accentColor: "#abcdef",
    statusLabel: "Producing",
  };
  const { host, elements } = buildFakeHudHost(buildFakeSelectionTarget(() => label));

  // A different sector is passed in — the present target must win, proving
  // getSelectedLabel()'s non-null return is used directly, never `?? sector`.
  updateGameHud(host, { name: "Verdant", lore: "x", gridX: 3, gridY: 4 });

  assertEqual(
    elements.selectedObjectElement.textContent,
    "Bloomreach",
    "writes the target's name, not the sector",
  );
  assertEqual(elements.serialCodeElement.textContent, "BIO-042", "writes the target's serial code");
  assertEqual(elements.selectedTypeElement.textContent, "Station · Large", "writes the target's stack label");
  assertEqual(elements.loreElement.textContent, "A farm.", "writes the target's lore");
});

/** Type-level check run by `npm run typecheck`, not the tsx runner: the
 *  canonical SelectionTarget.getSelectedLabel() return is non-null. An
 *  otherwise-complete target whose getSelectedLabel returns null must NOT
 *  type-check. Under the OLD `SelectionLabel | null` signature this compiled,
 *  so `@ts-expect-error` would be an unused-directive error then; under the
 *  narrowed contract the error is real and the directive satisfied. */
function typeCheckRejectsNullReturningGetSelectedLabel(): void {
  const { host } = buildFakeHudHost(null);
  const target: HudSelectionTarget = {
    kind: "station",
    enterSelected() {},
    exitSelected() {},
    isActive: () => true,
    canSelect: () => true,
    // @ts-expect-error getSelectedLabel must return a SelectionLabel, never null.
    getSelectedLabel: () => null,
    getMapPosition: () => null,
  };
  host.selection.selectedTarget = target;
}
void typeCheckRejectsNullReturningGetSelectedLabel;
