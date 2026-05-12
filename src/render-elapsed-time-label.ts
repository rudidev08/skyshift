export interface ElapsedTimeLabel {
  destroy(): void;
}

const REFRESH_MS = 500;

function decomposeSeconds(seconds: number): { days: number; hours: number; minutes: number; seconds: number } {
  const total = Math.max(0, Math.floor(seconds));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total / 3600) % 24),
    minutes: Math.floor((total / 60) % 60),
    seconds: total % 60,
  };
}

const padToTwoDigits = (value: number) => String(value).padStart(2, "0");

/** Two largest non-zero units so the HUD readout keeps a consistent width:
 *  m:s under an hour, h:m under a day, d:h beyond. */
export function formatElapsed(seconds: number): string {
  const parts = decomposeSeconds(seconds);
  if (parts.days > 0) return `${padToTwoDigits(parts.days)}d:${padToTwoDigits(parts.hours)}h`;
  if (parts.hours > 0) return `${padToTwoDigits(parts.hours)}h:${padToTwoDigits(parts.minutes)}m`;
  return `${padToTwoDigits(parts.minutes)}m:${padToTwoDigits(parts.seconds)}s`;
}

/** Countdown style: "M:SS" or "H:MM:SS". Always shows seconds so the readout
 *  reads as ticking, unlike formatElapsed which drops seconds at h+. */
export function formatHoursMinutesSeconds(seconds: number): string {
  const parts = decomposeSeconds(seconds);
  if (parts.hours > 0) return `${parts.hours}:${padToTwoDigits(parts.minutes)}:${padToTwoDigits(parts.seconds)}`;
  return `${parts.minutes}:${padToTwoDigits(parts.seconds)}`;
}

export function createElapsedTimeLabel(
  root: ParentNode,
  getSimTime: () => number,
  options?: { offsetSeconds?: number },
): ElapsedTimeLabel {
  const host = root.querySelector<HTMLElement>("#speed-hud-elapsed");
  const numberElement = host?.querySelector<HTMLElement>(".num");
  if (!host || !numberElement) {
    return { destroy() { /* does nothing on pages without the speed HUD */ } };
  }
  // Hide warmup pre-ticks from the player clock — callers pass
  // simulationWarmup so boot-time advancement doesn't show up as elapsed time.
  const offset = options?.offsetSeconds ?? 0;
  let lastText = "";
  const update = () => {
    const next = formatElapsed(getSimTime() - offset);
    if (next === lastText) return;
    numberElement.textContent = next;
    lastText = next;
  };
  update();
  const timer = window.setInterval(update, REFRESH_MS);
  return {
    destroy() {
      window.clearInterval(timer);
    },
  };
}
