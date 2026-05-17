interface SectorHeader {
  name: string;
  gridX: number;
  gridY: number;
}

/** Plain text: "Name (x, y)" — for raw text contexts (BitmapText etc.). */
export function sectorHeaderText(sector: SectorHeader): string {
  return `${sector.name} (${sector.gridX}, ${sector.gridY})`;
}
