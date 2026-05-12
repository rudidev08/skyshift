import { escapeHtml } from "./util-html-escape";

interface SectorHeader { name: string; gridX: number; gridY: number }

/** Plain text: "Name (x, y)" — for raw text contexts (BitmapText etc.). */
export function sectorHeaderText(sector: SectorHeader): string {
  return `${sector.name} (${sector.gridX}, ${sector.gridY})`;
}

/** HTML-safe variant: same content with the name escaped. */
export function sectorLabel(sector: SectorHeader): string {
  return `${escapeHtml(sector.name)} (${sector.gridX}, ${sector.gridY})`;
}

function capitalizeFirstLetter(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** "mineral-rich" → "Mineral Rich" — for sector environment labels. */
export function formatEnvironment(environment: string): string {
  const words = environment.split("-");
  const capitalized = words.map(capitalizeFirstLetter);
  return capitalized.join(" ");
}
