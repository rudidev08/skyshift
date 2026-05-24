/** Pads with a leading zero — e.g. 5 → "05". */
export const padToTwoDigits = (value: number) => String(value).padStart(2, "0");
