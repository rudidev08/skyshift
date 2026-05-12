// By-id collection for ship visual bundles. Trade-ship updates resolve
// `tradeShip.orbitingShipId` to a bundle through this lookup.

import type { ShipVisualBundle } from "./ship-visual-bundle";

export interface ShipVisualBundlesByShipId {
  add(bundle: ShipVisualBundle): void;
  remove(shipId: string): void;
  getById(shipId: string): ShipVisualBundle | undefined;
  reset(): void;
}

export function createShipVisualBundles(): ShipVisualBundlesByShipId {
  const byShipId = new Map<string, ShipVisualBundle>();
  return {
    add(bundle) {
      byShipId.set(bundle.ship.id, bundle);
    },
    remove(shipId) {
      byShipId.delete(shipId);
    },
    getById(shipId) {
      return byShipId.get(shipId);
    },
    reset() {
      byShipId.clear();
    },
  };
}
