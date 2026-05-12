// Cell ids shared between the economy editor's table-render pass and its
// post-render refresh pass, so a typo only breaks one site instead of both.

import type { WareId } from "../../data/ware-types";

export function shipThroughputCellId(shipId: string): string {
  return `throughput-${shipId}`;
}

export function shipStoragePercentCellId(shipId: string): string {
  return `storage-percent-${shipId}`;
}

export function shipSuggestedCargoCellId(shipId: string): string {
  return `suggested-${shipId}`;
}

export function wareProducedCellId(wareId: WareId): string {
  return `produced-${wareId}`;
}

export function wareConsumedCellId(wareId: WareId): string {
  return `consumed-${wareId}`;
}

export function wareNetCellId(wareId: WareId): string {
  return `net-${wareId}`;
}
