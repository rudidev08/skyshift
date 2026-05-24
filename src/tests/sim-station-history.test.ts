import { test, assertEqual, assertNotUndefined, assertTrue } from "./test-utils.ts";
import { createStationHistory } from "../sim-station-history.ts";
import { makeTimelapseStation } from "./factories.ts";

test("createStationHistory: empty state returns empty stations", () => {
  const history = createStationHistory();
  assertEqual(history.getStateAt(0).length, 0, "stations.length");
});

test("createStationHistory: created station appears at and after its event time", () => {
  const history = createStationHistory();
  history.recordCreated(100, makeTimelapseStation());
  assertEqual(history.getStateAt(99).length, 0, "before event");
  assertEqual(history.getStateAt(100).length, 1, "at event");
  const station = history.getStateAt(100)[0];
  assertEqual(station.id, "hub-tech-1", "id at event");
  // Pin position passthrough. The rewind overlay reads station.position.{x,y}
  // to draw discs on the map; zeroing or swapping the field would pile every
  // station at the origin.
  assertEqual(station.position.x, 100, "position.x");
  assertEqual(station.position.y, 200, "position.y");
  assertEqual(history.getStateAt(200).length, 1, "after event");
});

test("createStationHistory: removed event drops only the named station", () => {
  const history = createStationHistory();
  history.recordCreated(100, makeTimelapseStation({ id: "hub-tech-1" }));
  history.recordCreated(100, makeTimelapseStation({ id: "hub-tech-2" }));
  history.recordRemoved(200, "hub-tech-1");
  assertEqual(history.getStateAt(150).length, 2, "before removal");
  // Pin live.delete(id). Replacing it with live.clear() would survive a
  // single-station test but here drops the unrelated station too.
  const survivors = history.getStateAt(200);
  assertEqual(survivors.length, 1, "at removal");
  assertEqual(survivors[0].id, "hub-tech-2", "unrelated station survives");
});

test("createStationHistory: state-changed updates state without losing other fields", () => {
  const history = createStationHistory();
  history.recordCreated(100, makeTimelapseStation({ state: "construction" }));
  history.recordStateChanged(200, "hub-tech-1", "operational");
  const earlier = assertNotUndefined(history.getStateAt(150)[0], "earlier");
  const later = assertNotUndefined(history.getStateAt(250)[0], "later");
  assertEqual(earlier.state, "construction", "earlier state");
  assertEqual(later.state, "operational", "later state");
  assertEqual(later.position.x, earlier.position.x, "position.x preserved");
  assertEqual(later.position.y, earlier.position.y, "position.y preserved");
  assertEqual(later.nationId, earlier.nationId, "nationId preserved");
  assertEqual(later.typeId, earlier.typeId, "typeId preserved");
});

test("createStationHistory: counts per nation excluding WAY", () => {
  const history = createStationHistory();
  history.recordCreated(0, makeTimelapseStation({ id: "a", nationId: "hub" }));
  history.recordCreated(0, makeTimelapseStation({ id: "b", nationId: "bio" }));
  history.recordCreated(0, makeTimelapseStation({ id: "c", nationId: "way" }));
  const counts = history.getCountsAt(100);
  assertEqual(counts.get("hub"), 1, "hub count");
  assertEqual(counts.get("bio"), 1, "bio count");
  assertTrue(!counts.has("way"), "way absent from counts");
});

test("createStationHistory: round-trips through toSnapshot / fromSnapshot", () => {
  const history = createStationHistory();
  history.recordCreated(50, makeTimelapseStation());
  history.recordStateChanged(150, "hub-tech-1", "operational");
  const snapshot = history.toSnapshot();
  const restored = createStationHistory();
  restored.fromSnapshot(snapshot);
  const original = history.getStateAt(200)[0];
  const after = restored.getStateAt(200)[0];
  assertEqual(after.id, original.id, "id");
  assertEqual(after.state, original.state, "state");
  assertEqual(after.nationId, original.nationId, "nationId");
});
