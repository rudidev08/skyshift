import { Stone, AudioLines, Droplet, Apple, Pill, Hammer, Container, VectorSquare, Bed, Wrench, Compass } from "lucide-static";
import type { StationTypeId } from "../data/station-types";

export const iconSvgByStationType: Record<StationTypeId, string> = {
  "mine": Stone,
  "observatory": AudioLines,
  "water-processing": Droplet,
  "farm": Apple,
  "medical-lab": Pill,
  "metal-forge": Hammer,
  "tech-factory": Container,
  "archives": VectorSquare,
  "habitat": Bed,
  "shipyard": Wrench,
  "generational-ship": Compass,
};

/** Render a nation-tinted station icon as a data URI. */
export function renderStationIconDataUri(stationTypeId: StationTypeId, nationColor: string, size: number): string {
  const rawSvg = iconSvgByStationType[stationTypeId];
  // Strip the outer <svg> wrapper, keep the inner shape elements.
  const openTagEnd = rawSvg.indexOf(">");
  const closeTagStart = rawSvg.lastIndexOf("</svg>");
  const innerContent = rawSvg.substring(openTagEnd + 1, closeTagStart).replace(/currentColor/g, nationColor);
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"`,
    ` fill="none" stroke="${nationColor}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">`,
    innerContent,
    `</svg>`,
  ].join("");
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
