// Unique name assignment for stations and ships. Drawn without replacement
// from each nation's pool; reuse after exhaustion (or explicit duplicate)
// gets a nation-specific suffix (or numeric fallback if suffixes run out).
//
// Each Simulation owns one NamePool — two simulations don't collide on
// dynamic name claims.

import type { Nation } from "./sim-nation";

export class NamePool {
  private readonly usedNameCounts = new Map<string, number>();
  /** Owning nation per base name — suffix flavor follows the original claim. */
  private readonly nameNation = new Map<string, Nation>();
  /** Shuffled draw pile per source pool — without-replacement so every name
   *  runs before any suffix appears. */
  private readonly remainingNames = new Map<string[], string[]>();

  /** Claim a random unique station name from a nation's pool. */
  claimStationName(nation: Nation): string {
    return this.drawFromPool(nation.stationNames, nation);
  }

  /** Claim a random unique ship name from a nation's pool. */
  claimShipName(nation: Nation): string {
    return this.drawFromPool(nation.shipNames, nation);
  }

  /** Claim a specific name, adding a nation-flavored suffix if taken. Use for
   *  pre-authored names that still need global tracking so dynamic names won't
   *  conflict. */
  claimName(baseName: string, nation?: Nation): string {
    const count = this.usedNameCounts.get(baseName) ?? 0;
    this.usedNameCounts.set(baseName, count + 1);

    // Remember the original claimant for later suffix flavor.
    if (count === 0 && nation) this.nameNation.set(baseName, nation);

    if (count === 0) return baseName;

    const owner = nation ?? this.nameNation.get(baseName);
    const suffixes = owner?.nameSuffixes ?? [];
    const suffixIndex = count - 1;
    const suffix = suffixIndex < suffixes.length
      ? suffixes[suffixIndex]
      : String(count + 1);
    return `${baseName} ${suffix}`;
  }

  /** Reserve a pre-authored name from its nation's pool so dynamic draws
   *  don't collide. */
  reservePoolName(pool: string[], baseName: string): void {
    let remaining = this.remainingNames.get(pool);
    if (!remaining) {
      remaining = [...pool];
      shuffleNames(remaining);
      this.remainingNames.set(pool, remaining);
    }

    const reservedNameIndex = remaining.lastIndexOf(baseName);
    if (reservedNameIndex !== -1) {
      remaining.splice(reservedNameIndex, 1);
    }
  }

  /** Draw a name without replacement from a shuffled copy of the pool. After exhaustion, reshuffle the pool and let claimName's suffixing handle the duplicate. */
  private drawFromPool(pool: string[], nation: Nation): string {
    if (pool.length === 0) return "Unknown";

    let remaining = this.remainingNames.get(pool);
    if (!remaining || remaining.length === 0) {
      remaining = [...pool];
      shuffleNames(remaining);
      this.remainingNames.set(pool, remaining);
    }

    const baseName = remaining.pop()!;
    return this.claimName(baseName, nation);
  }

}

/** Assign names to every station in a map. Pre-authored names are claimed
 *  and reserved out of their nation's draw pile first, then unnamed stations
 *  draw from the remainder. Every station has a name on return.
 *
 *  Free function (not a NamePool method) so the `asserts` return-type
 *  narrows callers' parameter type — TS requires the call target to be a
 *  named declaration for asserts to flow through. */
export function assignStationNames<T extends { name?: string; nation: Nation }>(
  namePool: NamePool,
  stations: T[],
): asserts stations is (T & { name: string })[] {
  // First pass: reserve pre-authored names before any random draws.
  for (const station of stations) {
    if (station.name) {
      namePool.reservePoolName(station.nation.stationNames, station.name);
      namePool.claimName(station.name, station.nation);
    }
  }

  // Second pass: assign names to the unnamed.
  for (const station of stations) {
    if (!station.name) {
      station.name = namePool.claimStationName(station.nation);
    }
  }
}

function shuffleNames(names: string[]) {
  // Fisher-Yates in place — callers pass a copy of the canonical pool so the
  // authored order in data/nations.ts is never mutated.
  for (let i = names.length - 1; i > 0; i--) {
    const swapIndex = Math.floor(Math.random() * (i + 1));
    [names[i], names[swapIndex]] = [names[swapIndex], names[i]];
  }
}
