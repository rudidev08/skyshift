// Shared helpers for static-page Puppeteer tests that load each page and fail on console errors, page errors, or failed requests.
// Each test script is independently runnable: `node dev/static-tests/<name>.test.mjs`.
// `BASE_URL` and `--headed` apply uniformly across scripts.

import puppeteer from "puppeteer";

const BASE_URL = process.env.BASE_URL?.replace(/\/$/, "") || "http://localhost:5173";
const HEADED = process.argv.includes("--headed");

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function preflightCheck() {
  try {
    const response = await fetch(BASE_URL, { signal: AbortSignal.timeout(2000) });
    if (!response.ok && response.status !== 404) {
      throw new Error(`server responded ${response.status}`);
    }
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    console.error(`[preflight] cannot reach ${BASE_URL} (${reason}). Run \`npm run dev\` first.`);
    process.exit(2);
  }
}

export async function checkPage({ name, path, settleMs = 500, interact }) {
  await preflightCheck();
  const browser = await puppeteer.launch({ headless: !HEADED });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console.error: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    errors.push(`requestfailed: ${request.url()} (${request.failure()?.errorText ?? "unknown"})`);
  });

  const url = BASE_URL + path;
  console.log(`[${name}] loading ${url}`);
  try {
    await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });
    await wait(settleMs);
    if (interact) await interact(page);
    await wait(200);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    errors.push(`runner: ${reason}`);
  } finally {
    await browser.close();
  }

  if (errors.length > 0) {
    console.log(`[${name}] FAIL`);
    for (const error of errors) console.log(`  ${error}`);
    process.exit(1);
  }
  console.log(`[${name}] OK`);
}
