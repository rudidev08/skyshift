import { inject } from "@vercel/analytics";
import { isDevModeEnabled } from "./util-devmode";

/** Load the Vercel Web Analytics beacon, except on localhost where it would
 *  pollute production metrics. Called once at entry-script load. */
export function injectAnalyticsUnlessDev(): void {
  if (isDevModeEnabled()) return;
  inject({ scriptSrc: "/api/telemetry.js" });
}
