// Orientation page (`/help.html`): three mini sector animations + HUD icons.
// Verifies the entry script runs without errors and mounts the scene canvases.

import { checkPage } from "./page-test-helpers.mjs";

await checkPage({
  name: "orientation",
  path: "/help.html",
  settleMs: 800,
  async interact(page) {
    const counts = await page.evaluate(() => ({
      sceneCanvases: document.querySelectorAll("canvas[data-scene]").length,
      hudIcons: document.querySelectorAll("[data-icon]").length,
    }));
    if (counts.sceneCanvases === 0) throw new Error("no scene canvases mounted");
    if (counts.hudIcons === 0) throw new Error("no HUD icons rendered");
    console.log(`[orientation] scenes=${counts.sceneCanvases} icons=${counts.hudIcons}`);
  },
});
