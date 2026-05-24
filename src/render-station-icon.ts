import {
  Stone,
  AudioLines,
  Droplet,
  Apple,
  Pill,
  Hammer,
  Container,
  VectorSquare,
  Bed,
  Wrench,
  Compass,
} from "lucide-static";
import type { StationTypeId } from "../data/station-types";
import { svgToDataUri } from "./render-data-uri-cache";
import { stripLucideSvgWrapper } from "./render-lucide-svg";

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

export function renderStationIconDataUri(stationTypeId: StationTypeId, nationColor: string, sizePixels: number): string {
  const innerContent = stripLucideSvgWrapper(iconSvgByStationType[stationTypeId]).replace(
    /currentColor/g,
    nationColor,
  );
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePixels}" height="${sizePixels}" viewBox="0 0 24 24"`,
    ` fill="none" stroke="${nationColor}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">`,
    innerContent,
    `</svg>`,
  ].join("");
  return svgToDataUri(svg);
}
