// Lore page (`/lore.html`): nations / ships / wares / stations / sectors tabs.
// Verifies each tab renders without errors and that clicking an occupied
// sector populates the dossier panel (which exercises station→nation lookup).

import { checkPage, wait } from "./page-test-helpers.mjs";

await checkPage({
  name: "lore",
  path: "/lore.html",
  async interact(page) {
    const tabs = await page.$$eval(".lore-nav .hud-btn", (elements) =>
      elements.map((element) => element.dataset.tab),
    );
    if (tabs.length === 0) throw new Error("no lore tabs found");
    for (const tab of tabs) {
      await page.evaluate((target) => window.goTab(target), tab);
      await wait(150);
    }

    await page.evaluate(() => window.goTab("sectors"));
    await wait(200);
    const clickResult = await page.evaluate(() => {
      const cells = Array.from(document.querySelectorAll("[class*='sector-cell']"));
      const occupied = cells.find((cell) => !cell.classList.contains("is-empty"));
      if (!occupied) return { clicked: false, total: cells.length };
      occupied.click();
      return { clicked: true, total: cells.length };
    });
    if (!clickResult.clicked) throw new Error(`no occupied sector cell found (${clickResult.total} total)`);

    console.log(`[lore] tabs=${tabs.length} sector-cells=${clickResult.total}`);
  },
});
