/** Format a duration in seconds for display: "23s" under 60s, "1.5m" at 60s+. */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
}

/** Compact "1.2k" above 1000, plain integer below. */
export function formatQuantity(value: number): string {
  const rounded = Math.round(value);
  if (rounded >= 1000) return `${(rounded / 1000).toFixed(1)}k`;
  return String(rounded);
}

/** Format a 0-1 fraction as "X.X%". */
export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Trade magnitude: one decimal below 10 (the tenths matter at low volumes,
 *  e.g. 2.3 vs 2.7), rounded to an integer at 10 and above. Callers keep
 *  their own zero/empty/pluralization handling around this. */
export function formatTradeMagnitude(value: number): string {
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}

/** Keeps two significant digits across rate magnitudes: "1.2k", "12", "1.2", "0.12", "0". */
function formatRateValue(value: number): string {
  const absoluteRate = Math.abs(value);
  if (absoluteRate >= 1000) return `${(absoluteRate / 1000).toFixed(1)}k`;
  if (absoluteRate >= 1) return String(Math.round(absoluteRate));
  if (absoluteRate >= 0.1) return absoluteRate.toFixed(1);
  if (absoluteRate > 0) return absoluteRate.toFixed(2);
  return "0";
}

/** Sign prefix — unicode minus (U+2212), not ASCII hyphen. */
function plusMinusCharacter(value: number): string {
  return value >= 0 ? "+" : "−";
}

function formatRatePill(rate: number | undefined, rateLabel: string | undefined): string {
  if (rate === undefined) return "";
  const formatted = formatRateValue(rate);
  if (formatted === "0") return "";
  const suffix = rateLabel ?? "";
  const pillClass = rate >= 0 ? "pill-gold" : "pill-cyan";
  return `<span class="cargo-rate">, <span class="${pillClass}">${plusMinusCharacter(rate)}${formatted}${suffix}</span></span>`;
}

function formatReservationLine(reservation: number | undefined): string {
  if (reservation === undefined || reservation === 0) return "";
  const verb = reservation >= 0 ? "Inbound" : "Reserved";
  return `<br><span class="cargo-reserve">${verb} ${plusMinusCharacter(reservation)}${formatQuantity(Math.abs(reservation))}</span>`;
}

export interface CargoBarFormatInput {
  wareName: string;
  current: number;
  max: number;
  rate?: number;
  rateLabel?: string;
  reservation?: number;
}

/** Format a cargo bar as a `.cargo-row` for use inside a `.cargo-grid`. */
export function formatCargoBar(input: CargoBarFormatInput): string {
  const { wareName, current, max, rate, rateLabel, reservation } = input;
  const percent = max > 0 ? (current / max) * 100 : 0;
  const currentDisplay = formatQuantity(current);
  const maxDisplay = formatQuantity(max);
  const ratePill = formatRatePill(rate, rateLabel);
  const reservationLine = formatReservationLine(reservation);

  return (
    `<div class="cargo-row">` +
    `<span class="cargo-label">${wareName}</span>` +
    `<span class="cargo-track"><span class="cargo-fill" style="width:${percent.toFixed(1)}%"></span></span>` +
    `<span class="cargo-stat">${currentDisplay}/${maxDisplay}${ratePill}${reservationLine}</span>` +
    `</div>`
  );
}
