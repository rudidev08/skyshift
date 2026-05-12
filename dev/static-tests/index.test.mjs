// Landing page (`/`): renders start-actions plus the secondary nav.
// First-visit (empty localStorage) shows preset enter buttons; this test
// verifies the page loads, the script populates start-actions, and the
// secondary nav links exist.

import { checkPage, wait } from "./lib.mjs";

await checkPage({
  name: "index",
  path: "/",
  async interact(page) {
    await wait(500);
    const counts = await page.evaluate(() => ({
      startButtons: document.querySelectorAll("[data-role='start-actions'] button").length,
      navLinks: document.querySelectorAll(".landing-nav a").length,
    }));
    if (counts.startButtons === 0) throw new Error("start-actions did not render any buttons");
    if (counts.navLinks < 4) throw new Error(`expected ≥4 nav links, got ${counts.navLinks}`);
    console.log(`[index] start-buttons=${counts.startButtons} nav-links=${counts.navLinks}`);
  },
});
