import type { Sector } from "./sim-map-types";

export function findSectorAtPosition(sectors: Sector[], mapX: number, mapY: number): Sector | undefined {
  if (sectors.length === 0) return undefined;
  const half = sectors[0].size / 2;
  for (const sector of sectors) {
    if (Math.abs(mapX - sector.x) <= half && Math.abs(mapY - sector.y) <= half) return sector;
  }
  return undefined;
}

interface MapPosition {
  x: number;
  y: number;
}

export function findSectorForStation(map: { sectors: Sector[] }, station: MapPosition): Sector | undefined {
  return findSectorAtPosition(map.sectors, station.x, station.y);
}
