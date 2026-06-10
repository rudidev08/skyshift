import { test, assertEqual } from "./test-utils.ts";
import { nationColoredCodeSpan } from "../sim-nation-code-format.ts";
import { oreNation, skyNation } from "../../data/nations.ts";

// nationColoredCodeSpan wraps a nation's code in a color-styled span. Pin the
// exact HTML for a known nation so a change to the markup (tag, attribute, or
// which fields it reads) is caught — the output is interpolated into the HUD
// and event-log strings.

test("nationColoredCodeSpan: wraps codeName in a span colored by nation.color", () => {
  assertEqual(
    nationColoredCodeSpan(oreNation),
    `<span style="color:#B36100">ORE</span>`,
    "ORE code in its nation color",
  );
});

test("nationColoredCodeSpan: reads color and codeName from the passed nation", () => {
  // A second nation confirms both fields are sourced from the argument, not
  // hardcoded to one nation.
  assertEqual(
    nationColoredCodeSpan(skyNation),
    `<span style="color:#00F9FF">SKY</span>`,
    "SKY code in its nation color",
  );
});
