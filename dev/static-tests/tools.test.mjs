// Tools (`/tools.html`): three top-level tabs — Map Editor, Economy Editor, Timelapse.
// Verifies tab switching does not throw and the timelapse tab can run a 3d sim
// to enable step buttons. Editor internals (mode buttons, draft list, simulation
// preview) are out of scope.
//
// Why `clickInPage` instead of `page.click`: headless Chromium aggressively
// throttles RAF + the Phaser canvas's CDP interactability check makes
// `page.click` hang for the protocolTimeout. Programmatic `element.click()`
// fires the click handler directly and avoids both. The user-visible feature
// still works in real browsers; this is a test-harness workaround.

import { checkPage, wait } from "./lib.mjs";

const clickInPage = (page, selector) =>
  page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!element) throw new Error(`clickInPage: ${sel} not found`);
    element.click();
  }, selector);

const setSelectInPage = (page, selector, value) =>
  page.evaluate(({ sel, val }) => {
    const select = document.querySelector(sel);
    if (!select) throw new Error(`setSelectInPage: ${sel} not found`);
    select.value = val;
    select.dispatchEvent(new Event("change"));
  }, { sel: selector, val: value });

await checkPage({
  name: "tools",
  path: "/tools.html",
  settleMs: 1500,
  async interact(page) {
    await page.waitForSelector("[data-editor-tab='map']", { timeout: 10_000 });
    await page.waitForSelector("[data-editor-tab='economy']", { timeout: 10_000 });
    await page.waitForSelector("[data-editor-tab='timelapse']", { timeout: 10_000 });

    await clickInPage(page, "[data-editor-tab='economy']");
    await wait(400);
    await clickInPage(page, "[data-editor-tab='map']");
    await wait(400);
    await clickInPage(page, "[data-editor-tab='timelapse']");
    await wait(800);

    // Run shortest duration (3d). Wait for the diagnostics button to become
    // visible — that's the signal the run finished.
    await setSelectInPage(page, "#timelapse-duration", "259200");
    await clickInPage(page, "#timelapse-run");
    // `polling: 250` overrides waitForFunction's default `polling: "raf"`,
    // which is unreliable in headless because Chromium throttles RAF when
    // the tab isn't visible. Setting an explicit interval makes the wait
    // observable regardless of headless RAF state.
    await page.waitForFunction(
      () => !document.getElementById("timelapse-diagnostics").hidden,
      { timeout: 60_000, polling: 250 },
    );

    // Step buttons live inside the shared StationsTimelapseControl mount —
    // selected by data-step rather than id since the component owns them.
    await clickInPage(page, "#timelapse-control-mount [data-step='-1h']");
    await wait(200);

    await clickInPage(page, "[data-editor-tab='map']");
    await wait(400);

    console.log(`[tools] tab switches=4, run=ok, step=ok`);
  },
});
