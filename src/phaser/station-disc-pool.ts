// StationDiscPool: per timelapse-frame station, draws a nation-colored disc
// + a station-type icon centered on it. Pool keys by station id so frame-to-frame
// updates only mutate the entries that changed. Shared by the editor's
// Timelapse scene and the live game's StationRewindOverlay.

import Phaser from "phaser";
import type { TimelapseStation } from "../sim-timelapse-state";
import { getStationIconTextureKey } from "./texture-cache";
import { getNationById } from "../sim-nation";

/** Disc diameter in map units. Sized so a station is obvious at the
 *  fit-to-map zoom (sectorSize × gridSize ≈ 7500 × 6000 units fitting into
 *  ~1000 × 600 px → ~0.1× zoom; 250 units → ~25 px on screen). Exported so
 *  the timelapse scene can pad fit-to-map bounds by a disc radius — without
 *  the pad, a station whose center sits on the map edge has half its disc
 *  clipped by the canvas border. */
export const DISC_DIAMETER = 250;

interface StationVisual {
  disc: Phaser.GameObjects.Graphics;
  icon: Phaser.GameObjects.Image;
  /** Generation counter from the most recent draw that included this station.
   *  Used to sweep absent entries without allocating a Set per draw. */
  lastSeenGeneration: number;
}

// Cached parsed nation hex per nation id — `Phaser.Display.Color.HexStringToColor`
// re-parses on every call (hundreds per timelapse run), and the nation set is
// bounded (~6 nations) and hand-written, so caching at module scope is safe.
const parsedColorByNationId = new Map<string, number>();

function getParsedNationColor(nationId: string): number {
  const cached = parsedColorByNationId.get(nationId);
  if (cached !== undefined) return cached;
  const nation = getNationById(nationId);
  const parsed = Phaser.Display.Color.HexStringToColor(nation.color).color;
  parsedColorByNationId.set(nationId, parsed);
  return parsed;
}

export class StationDiscPool {
  private readonly visualByStationId = new Map<string, StationVisual>();
  private generation = 0;

  constructor(private readonly scene: Phaser.Scene) {}

  /** Adds visuals for stations new in `stations`, removes absent ones, repositions / recolors stale ones. */
  draw(stations: TimelapseStation[]): void {
    this.generation++;
    const drawGeneration = this.generation;
    for (const station of stations) this.upsertEntry(station, drawGeneration);
    this.sweepAbsentEntries(drawGeneration);
  }

  /** Destroys every visual the pool owns. Call from scene shutdown. */
  destroy(): void {
    for (const entry of this.visualByStationId.values()) {
      entry.disc.destroy();
      entry.icon.destroy();
    }
    this.visualByStationId.clear();
  }

  private upsertEntry(station: TimelapseStation, drawGeneration: number): void {
    let entry = this.visualByStationId.get(station.id);
    if (!entry) {
      entry = this.createEntry(station);
      this.visualByStationId.set(station.id, entry);
    }
    entry.lastSeenGeneration = drawGeneration;
    this.updateEntry(entry, station);
  }

  private sweepAbsentEntries(drawGeneration: number): void {
    for (const [id, entry] of this.visualByStationId) {
      if (entry.lastSeenGeneration === drawGeneration) continue;
      entry.disc.destroy();
      entry.icon.destroy();
      this.visualByStationId.delete(id);
    }
  }

  private createEntry(station: TimelapseStation): StationVisual {
    const disc = this.scene.add.graphics();
    const icon = this.scene.add.image(
      station.position.x,
      station.position.y,
      getStationIconTextureKey(station.typeId),
    );
    icon.setOrigin(0.5, 0.5);
    icon.setDisplaySize(DISC_DIAMETER * 0.7, DISC_DIAMETER * 0.7);
    return { disc, icon, lastSeenGeneration: 0 };
  }

  private updateEntry(entry: StationVisual, station: TimelapseStation): void {
    const nationColor = getParsedNationColor(station.nationId);
    const alpha = station.state === "construction" ? 0.45 : 1;

    entry.disc.clear();
    entry.disc.fillStyle(nationColor, alpha);
    entry.disc.fillCircle(station.position.x, station.position.y, DISC_DIAMETER / 2);

    // Icon stays white (no tint) so the type glyph is legible against the
    // nation-colored disc. Without this, the icon would be the same color
    // as the disc and disappear visually.
    entry.icon.setPosition(station.position.x, station.position.y);
    entry.icon.setAlpha(alpha);

    const expectedKey = getStationIconTextureKey(station.typeId);
    if (entry.icon.texture.key !== expectedKey) {
      entry.icon.setTexture(expectedKey);
    }
  }
}
