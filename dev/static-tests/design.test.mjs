// UI Design showcase (`/design.html`): static HTML reference for ui.css tokens
// and component classes. No tabs — this test just verifies the page loads,
// the entry script runs without errors, and the showcase rendered content.

import { checkPage } from "./page-test-helpers.mjs";

await checkPage({
  name: "design",
  path: "/design.html",
  settleMs: 600,
  async interact(page) {
    const counts = await page.evaluate(() => ({
      hudButtons: document.querySelectorAll(".hud-btn").length,
      idCards: document.querySelectorAll(".id-card").length,
    }));
    if (counts.hudButtons === 0) throw new Error("no .hud-btn samples rendered");
    if (counts.idCards === 0) throw new Error("no .id-card samples rendered");
    console.log(`[design] hud-buttons=${counts.hudButtons} id-cards=${counts.idCards}`);
  },
});
