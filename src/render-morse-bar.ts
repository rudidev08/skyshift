const MORSE: Record<string, string> = {
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.",
  G: "--.", H: "....", I: "..", J: ".---", K: "-.-", L: ".-..",
  M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.",
  S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-",
  Y: "-.--", Z: "--..",
};

const LETTER_COUNT = 4;
const DOT = 1;
const DASH = 3;
const INTRA_GAP = 1;
const INTER_GAP = 3;

interface MorseSegment {
  mark: boolean;
  units: number;
}

/** CSS gradient that paints the first `letterCount` letters of `name` as a morse stripe — used as a panel background accent. Returns "none" when `name` has no letters so the caller can drop the bar. */
export function morseBarGradient(
  name: string,
  { letterCount = LETTER_COUNT, color = "var(--paper-dim)" }: { letterCount?: number; color?: string } = {},
): string {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, letterCount);
  if (letters.length === 0) return "none";
  const segments = expandLettersToSegments(letters);
  const stops = segmentsToGradientStops(segments, color);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

function expandLettersToSegments(letters: string): MorseSegment[] {
  const segments: MorseSegment[] = [];
  for (let i = 0; i < letters.length; i++) {
    if (i > 0) segments.push({ mark: false, units: INTER_GAP });
    const code = MORSE[letters[i]];
    for (let j = 0; j < code.length; j++) {
      if (j > 0) segments.push({ mark: false, units: INTRA_GAP });
      segments.push({ mark: true, units: code[j] === "." ? DOT : DASH });
    }
  }
  return segments;
}

function segmentsToGradientStops(segments: MorseSegment[], color: string): string[] {
  const total = segments.reduce((sum, segment) => sum + segment.units, 0);
  const stops: string[] = [];
  let cursor = 0;
  for (const segment of segments) {
    const start = (cursor / total) * 100;
    const end = ((cursor + segment.units) / total) * 100;
    const markColor = segment.mark ? color : "transparent";
    stops.push(`${markColor} ${start.toFixed(2)}%`);
    stops.push(`${markColor} ${end.toFixed(2)}%`);
    cursor += segment.units;
  }
  return stops;
}
