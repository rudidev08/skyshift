import { test, assertEqual, assertTrue } from "./test-utils.ts";
import { makeStation } from "./factories.ts";
import { formatStationTypeAndSizeLabel } from "../phaser/station-visual-bundle.ts";
import { shortNameBySize } from "../../data/stations.ts";

test("station type/size label is derived from station state alone, not a stored field", () => {
  // Guard for item 13 — the label is a pure function of the station's current
  // state/size/nation/stationType, computed render-side. Under the OLD
  // behavior it was a stored Station.typeAndSizeLabel string set at
  // construction and re-copied on the build→producing flip; this helper did
  // not exist (so the test would not compile against OLD), and a missed
  // re-copy writer could leave the stored string showing the wrong form.
  const station = makeStation({ size: "M", placement: { state: "building" } });

  // Building form: a "Building <type> (<size>)" banner, regardless of any
  // value a stored field might have held.
  const buildingLabel = formatStationTypeAndSizeLabel(station);
  assertTrue(buildingLabel.startsWith("Building "), `building label starts with "Building ": ${buildingLabel}`);
  assertEqual(
    buildingLabel,
    `Building ${station.stationType.name} (${station.size})`,
    "building label is the build banner form",
  );

  // Flip to producing with no other change — the label must follow state
  // deterministically, which a stored-then-re-copied string cannot guarantee.
  station.state = "producing";
  assertEqual(
    formatStationTypeAndSizeLabel(station),
    `${shortNameBySize[station.size]} ${station.nation.codeName} ${station.stationType.name}`,
    "producing label is short-code + nation + station-type",
  );
});
