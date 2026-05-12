// HUD-facing display helpers for trade ships: status label, the cargo-grid
// description rendered in the info card, the predicates the ship visual
// bundle uses to gate selection / idle states, and the multi-line trade
// log shown in the expandable details panel.
//
// Pure read-only formatters — every entry takes a TradeShip + the live
// TradeManager + currentTime; resolvers and the trade clock flow through
// the manager. Don't mutate sim state here; the manager and queue files
// own the writes.

import { economyConfig } from "../data/economy-config";
import type { WareId } from "../data/ware-types";
import type { TradeDirection } from "./sim-trade-types";
import { getInventorySlot, getAllInventorySlots, type Station, type InventorySlot } from "./sim-station";
import { stationCodeNameLabel } from "./sim-station-template";
import { getShipTemplate } from "./sim-ship-template";
import { getWareTemplate } from "./sim-ware-template";
import type { ShipTemplate } from "../data/ship-types";
import type { ShipAction } from "./sim-travel-types";
import { formatQuantity, formatDuration, formatCargoBar } from "./util-quantity-format";
import { nationColoredCodeSpan } from "./sim-nation-code-format";
import { type TradeShip } from "./sim-trade-types";
import type { TradeManager } from "./sim-trade-manager";
import {
  effectiveAvailable,
  effectiveSpace,
  effectiveFillPercent,
  getTradeBuyDemand,
  getTradeSellSupply,
} from "./sim-trade-decision";

/** Player-selectable when idle, waiting to deploy, or on an inter-station flight. */
export function isTradeShipSelectable(ship: TradeShip): boolean {
  if (ship.actionQueue.length === 0) return true; // idle
  const current = ship.actionQueue[0];
  if (current.type === "fly" && current.travelMode === "interStation") return true;
  return false;
}

/** Action queue is empty — orbiting, waiting for trade. */
export function isTradeShipIdle(ship: TradeShip): boolean {
  return ship.actionQueue.length === 0;
}

/** Waiting to deploy (stagger timer not yet fired). */
export function isTradeShipDeploying(ship: TradeShip): boolean {
  if (ship.actionQueue.length === 0) return false;
  const current = ship.actionQueue[0];
  return current.type === "fly" && current.deploying === true;
}

/** "BIO Bloomreach" with only the nation code tinted. */
function formatStation(station: Station): string {
  return `<b>${nationColoredCodeSpan(station.nation)}</b>\u00a0<b>${station.name}</b>`;
}

/** Pending cargo amount from a future withdraw action in the queue. */
function getPendingCargo(ship: TradeShip, wareId: WareId): number {
  for (const action of ship.actionQueue) {
    if (action.type === "cargo-withdrawal" && action.wareId === wareId) return action.amount;
  }
  return 0;
}

/** Full-width label/value row inside cargo-grid; `value` may contain HTML (e.g. `<br>` for multi-line). */
function buildCargoNote(label: string, value: string): string {
  return `<div class="cargo-note"><span class="cargo-note-label">${label}</span><div class="cargo-note-value">${value}</div></div>`;
}

/** Format a 0-1 fraction as "X.X%". */
function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Render a slot's current quantity plus reservation deltas, e.g. "(120 +30 in -10 out)". */
function slotDetails(slot: InventorySlot): string {
  const parts: string[] = [formatQuantity(slot.current)];
  if (slot.reservedIncoming > 0) parts.push(`+${formatQuantity(slot.reservedIncoming)} in`);
  if (slot.reservedOutgoing > 0) parts.push(`-${formatQuantity(slot.reservedOutgoing)} out`);
  return `(${parts.join(" ")})`;
}

/** Sub-row used by idle-log fallback candidate listings — nation code, station name, fill %, slot details. */
function formatSubRow(station: Station, slot: InventorySlot): string {
  return `<div class="log-sub">&nbsp;· ${nationColoredCodeSpan(station.nation)} <span class="log-ware">${station.name}:</span> <span class="log-num">${formatPercent(effectiveFillPercent(slot))}</span> ${slotDetails(slot)}</div>`;
}

/** Status-band label for the info card (e.g. "Flying"). */
export function getTradeShipStatusLabel(ship: TradeShip): string {
  if (ship.actionQueue.length === 0) return "Looking for Traders";
  if (isTradeShipDeploying(ship)) return "Deploying";
  const current = ship.actionQueue[0];
  if (current.type === "fly") return "Flying";
  return "Trading";
}

/** Empty cargo bar shown for ships with nothing in the hold or still deploying. */
function formatEmptyCargoBar(capacity: number): string {
  return formatCargoBar({ wareName: "No Cargo", current: 0, max: capacity });
}

/** Idle ship — empty cargo bar plus "last trade Xs ago" when a previous trade has occurred. */
function formatIdleTradeShipDescription(ship: TradeShip, capacity: number, currentTime: number): string {
  const cargoBar = formatEmptyCargoBar(capacity);
  const idleElapsed = ship.idleStartTime > 0 ? currentTime - ship.idleStartTime : 0;
  if (idleElapsed <= 0) return cargoBar;
  const statusRow = buildCargoNote("Status", `<span class="cargo-note-dim">Last trade ${formatDuration(idleElapsed)} ago</span>`);
  return `${cargoBar}${statusRow}`;
}

/** Deploying ship — empty cargo bar plus "Deploying to <home>" status row. */
function formatDeployingTradeShipDescription(homeStationDefinition: Station | null, capacity: number): string {
  const cargoBar = formatEmptyCargoBar(capacity);
  const destinationLabel = homeStationDefinition ? formatStation(homeStationDefinition) : "home";
  return `${cargoBar}${buildCargoNote("Status", `Deploying to ${destinationLabel}`)}`;
}

/** One bar per ware in the hold, or a single "No Cargo" bar when empty. */
function formatActiveCargoBars(ship: TradeShip, capacity: number): string {
  if (ship.cargoAmountByWareId.size === 0) return formatEmptyCargoBar(capacity);
  const bars: string[] = [];
  for (const [wareId, amount] of ship.cargoAmountByWareId) {
    const ware = getWareTemplate(wareId);
    const pendingChange = getPendingCargo(ship, wareId);
    bars.push(formatCargoBar({ wareName: ware.name, current: amount, max: capacity, rate: pendingChange }));
  }
  return bars.join("");
}

/** Route or status note derived from the head action in the queue. */
function formatActiveActionNote(currentAction: ShipAction): string {
  if (currentAction.type === "fly") {
    if (currentAction.route) {
      const { fromStation, toStation } = currentAction.route;
      return buildCargoNote("Route", `${formatStation(fromStation)} <span class="cargo-note-dim">to</span><br>${formatStation(toStation)}`);
    }
    return buildCargoNote("Status", currentAction.label);
  }
  if (currentAction.type === "wait") return buildCargoNote("Status", currentAction.label);
  if (currentAction.type === "cargo-withdrawal" || currentAction.type === "cargo-deposit") {
    return buildCargoNote("Status", `Transferring cargo at ${stationCodeNameLabel(currentAction.station)}`);
  }
  return "";
}

/** Info-panel HTML for a trade ship. Injected into `.cargo-grid` — bare grid
 *  children (label / track / stat) plus optional cargo-note rows, no wrapper. */
export function getTradeShipDescription(ship: TradeShip, manager: TradeManager, currentTime: number): string {
  // Home may be missing for emigrating ships on a ferry-to-generational-ship
  // queue after home demolition; fall back so the panel still renders the cargo + label.
  const homeStationDefinition = manager.stationResolver(ship.homeStationId);
  const capacity = getShipTemplate(manager.requireResolvedShip(ship.orbitingShipId).shipTypeId).cargoCapacity;

  if (ship.actionQueue.length === 0) return formatIdleTradeShipDescription(ship, capacity, currentTime);
  if (isTradeShipDeploying(ship)) return formatDeployingTradeShipDescription(homeStationDefinition ?? null, capacity);

  const cargoBars = formatActiveCargoBars(ship, capacity);
  const note = formatActiveActionNote(ship.actionQueue[0]);
  return `${cargoBars}${note}`;
}

// Line colors live in `.log-panel-body .is-*` in ui.css; formatters here only set the `is-*` class.

function formatAction(action: ShipAction): string {
  switch (action.type) {
    case "fly": return action.label;
    case "wait": return action.label;
    case "cargo-withdrawal": return `Load: ${formatQuantity(action.amount)} ${action.wareId}`;
    case "cargo-deposit": return `Deliver: ${formatQuantity(action.amount)} ${action.wareId}`;
    case "decommission": return action.label;
  }
}

/** Concise trade-state explanation for the details panel. */
export function getTradeLog(ship: TradeShip, manager: TradeManager, currentTime: number): string {
  const shipTemplate = getShipTemplate(manager.requireResolvedShip(ship.orbitingShipId).shipTypeId);
  if (shipTemplate.cargoCapacity === 0) return `<span class="is-blocked">Ship has no cargo capacity</span>`;
  if (isTradeShipDeploying(ship)) return `<span class="is-blocked">Deploying — not yet trading</span>`;
  if (ship.actionQueue.length > 0) return formatActiveTradeLog(ship, manager);
  return formatIdleTradeLog(ship, shipTemplate, manager, currentTime);
}

/** Buy/Sell summary line plus From/To station rows with fill levels, and Bonus rows for any extra cargo.
 *  Empty when home or target station is gone (mid-ferry emigration) — caller still renders the action queue. */
function formatActiveTradeSummary(ship: TradeShip, manager: TradeManager): string[] {
  const home = manager.stationResolver(ship.homeStationId);
  const targetStation = ship.targetStationId ? manager.stationResolver(ship.targetStationId) ?? null : null;
  const cargoEntries = [...ship.cargoAmountByWareId.entries()];
  const primary = cargoEntries[0];
  if (!home || !primary || !targetStation) return [];

  const [primaryWareId] = primary;
  const primaryWare = getWareTemplate(primaryWareId);
  const sourceStation = ship.tradeDirection === "sell" ? home : targetStation;
  const destinationStation = ship.tradeDirection === "sell" ? targetStation : home;
  const sourceSlot = getInventorySlot(sourceStation, primaryWareId);
  const destinationSlot = getInventorySlot(destinationStation, primaryWareId);

  const actionLabel = ship.tradeDirection === "sell" ? "Selling" : "Buying";

  const lines: string[] = [];
  lines.push(`<span class="is-label">${actionLabel}:</span> ${primaryWare.name}`);

  if (sourceSlot) {
    lines.push(`<span class="is-label">From:</span> ${stationCodeNameLabel(sourceStation)} ${formatPercent(effectiveFillPercent(sourceSlot))} filled (${formatQuantity(sourceSlot.current)}/${formatQuantity(sourceSlot.max)})`);
  }
  if (destinationSlot) {
    lines.push(`<span class="is-label">To:</span> ${stationCodeNameLabel(destinationStation)} ${formatPercent(effectiveFillPercent(destinationSlot))} filled (${formatQuantity(destinationSlot.current)}/${formatQuantity(destinationSlot.max)})`);
  }

  for (let i = 1; i < cargoEntries.length; i++) {
    const [extraWareId, extraAmount] = cargoEntries[i];
    const extraWare = getWareTemplate(extraWareId);
    lines.push(`<span class="is-label">Bonus:</span> ${extraWare.name} (${formatQuantity(extraAmount)} on ship)`);
  }

  return lines;
}

/** One line per queued action; the head of the queue is prefixed with ▸ and styled as the current step. */
function formatActionQueueWithCurrentSelected(ship: TradeShip): string[] {
  const lines: string[] = [];
  for (let i = 0; i < ship.actionQueue.length; i++) {
    const prefix = i === 0 ? "▸ " : "  ";
    const className = i === 0 ? "is-current" : "is-blocked";
    lines.push(`<span class="${className}">${prefix}${formatAction(ship.actionQueue[i])}</span>`);
  }
  return lines;
}

/** Log for ships on an active trade run — trade summary plus action plan. */
function formatActiveTradeLog(ship: TradeShip, manager: TradeManager): string {
  return [
    ...formatActiveTradeSummary(ship, manager),
    ...formatActionQueueWithCurrentSelected(ship),
  ].join("<br>");
}

/** Counterpart station paired with the slot evaluated and the score used to
 *  rank near-misses for display (demand for sell, supply for buy). */
interface ScoredCandidate {
  station: Station;
  slot: InventorySlot;
  score: number;
}

/** Sell ranks consumers by buy-demand; buy ranks producers by sell-supply.
 *  Mirrors `pickDestinationStation`'s scoreFor selector. */
function scoreForDirection(
  direction: TradeDirection,
): (station: Station, slot: InventorySlot) => number {
  return direction === "sell"
    ? (station, slot) => getTradeBuyDemand(station, slot)
    : (_station, slot) => getTradeSellSupply(slot);
}

/** Consumers (sell direction) or producers (buy direction) of `wareId`. */
function counterpartStations(
  manager: TradeManager,
  wareId: WareId,
  direction: TradeDirection,
): readonly Station[] {
  return direction === "sell"
    ? manager.wareStationIndex.getConsumers(wareId)
    : manager.wareStationIndex.getProducers(wareId);
}

/** Counterparts whose score beats home's — mirrors pickDestinationStation's
 *  eligibility filter so the log matches what the trade decision actually picks. */
function selectEligibleCounterparts(
  slot: InventorySlot,
  home: Station,
  manager: TradeManager,
  direction: TradeDirection,
): ScoredCandidate[] {
  const scoreFn = scoreForDirection(direction);
  const homeScore = scoreFn(home, slot);
  const eligible: ScoredCandidate[] = [];
  for (const station of counterpartStations(manager, slot.ware.id, direction)) {
    if (station === home) continue;
    const counterpartSlot = getInventorySlot(station, slot.ware.id);
    if (!counterpartSlot) continue;
    const score = scoreFn(station, counterpartSlot);
    if (score > homeScore) eligible.push({ station, slot: counterpartSlot, score });
  }
  return eligible;
}

/** Top 3 near-misses (highest score among ineligibles) when no counterpart qualifies. */
function selectFallbackCandidates(
  slot: InventorySlot,
  home: Station,
  manager: TradeManager,
  direction: TradeDirection,
): ScoredCandidate[] {
  const scoreFn = scoreForDirection(direction);
  const homeScore = scoreFn(home, slot);
  const candidates: ScoredCandidate[] = [];
  for (const station of counterpartStations(manager, slot.ware.id, direction)) {
    if (station === home) continue;
    const counterpartSlot = getInventorySlot(station, slot.ware.id);
    if (!counterpartSlot) continue;
    const score = scoreFn(station, counterpartSlot);
    if (score > homeScore) continue;
    candidates.push({ station, slot: counterpartSlot, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, 3);
}

/** Highest-scoring counterpart — best place to ship to/from. Deterministic
 *  first-tie pick keeps the log stable across renders. */
function selectBestCounterpart(eligible: ScoredCandidate[]): ScoredCandidate | null {
  if (eligible.length === 0) return null;
  let best = eligible[0];
  for (let i = 1; i < eligible.length; i++) {
    if (eligible[i].score > best.score) best = eligible[i];
  }
  return best;
}

/** Fallback log block: home fill, slot details, and the top-3 candidates that
 *  *would* be eligible if the relevant fill condition flipped. */
function formatFallbackBlock(slot: InventorySlot, candidates: ScoredCandidate[], wareLabel: string, missingMessage: string): string[] {
  const homeFill = effectiveFillPercent(slot);
  const tail = candidates.length === 0
    ? `, ${missingMessage}`
    : `, ${missingMessage}, ${candidates.length} most eligible:`;
  const lines: string[] = [];
  lines.push(`<div>${wareLabel} <span class="log-num">${formatPercent(homeFill)}</span> <span class="log-dim">${slotDetails(slot)}</span><span class="log-tail">${tail}</span></div>`);
  for (const candidate of candidates) {
    lines.push(formatSubRow(candidate.station, candidate.slot));
  }
  return lines;
}

/** Below-min-fill log line — quantity available, percent of capacity it'd fill, and the threshold note. */
function formatBelowMinFillLine(wareLabel: string, amount: number, capacity: number, fillRatio: number): string {
  return `<div>${wareLabel} <span class="log-num">${formatQuantity(amount)}/${formatQuantity(capacity)}</span> <span class="log-dim">(${formatPercent(fillRatio)})</span><span class="log-tail"> below min fill</span></div>`;
}

/** Idle-log block for a ware the home station produces. Returns the sell-side
 *  status: no surplus, no destination needs it (with fallback candidates),
 *  below-min-fill, or ready-to-ship. */
function formatSellWareLog(slot: InventorySlot, home: Station, capacity: number, minimumFill: number, manager: TradeManager): string[] {
  const wareLabel = `<span class="log-ware">${slot.ware.name}</span> <span class="log-dim">(sell):</span>`;

  const available = effectiveAvailable(slot);
  if (available <= 0) {
    return [`<div>${wareLabel}<span class="log-tail"> no surplus</span> <span class="log-dim">${slotDetails(slot)}</span></div>`];
  }

  const eligible = selectEligibleCounterparts(slot, home, manager, "sell");
  if (eligible.length === 0) {
    return formatFallbackBlock(slot, selectFallbackCandidates(slot, home, manager, "sell"), wareLabel, "no destination needs it");
  }

  const best = selectBestCounterpart(eligible);
  if (!best) return [];

  const amount = Math.min(capacity, available, effectiveSpace(best.slot));
  const fillRatio = amount / capacity;

  if (fillRatio < minimumFill) {
    return [formatBelowMinFillLine(wareLabel, amount, capacity, fillRatio)];
  }
  return [`<div class="is-ready">${wareLabel} <span class="log-num">${formatQuantity(amount)}</span> → ${nationColoredCodeSpan(best.station.nation)} <span class="log-ware">${best.station.name}</span> <span class="log-dim">(${eligible.length} dest)</span></div>`];
}

/** Idle-log block for a ware the home station consumes. Returns the buy-side
 *  status: full, no producer has surplus (with fallback candidates),
 *  below-min-fill, or ready-to-load. */
function formatBuyWareLog(slot: InventorySlot, home: Station, capacity: number, minimumFill: number, manager: TradeManager): string[] {
  const wareLabel = `<span class="log-ware">${slot.ware.name}</span> <span class="log-dim">(buy):</span>`;

  const space = effectiveSpace(slot);
  if (space <= 0) {
    return [`<div>${wareLabel}<span class="log-tail"> full</span> <span class="log-dim">${slotDetails(slot)}</span></div>`];
  }

  const eligible = selectEligibleCounterparts(slot, home, manager, "buy");
  if (eligible.length === 0) {
    return formatFallbackBlock(slot, selectFallbackCandidates(slot, home, manager, "buy"), wareLabel, "no producer has surplus");
  }

  const best = selectBestCounterpart(eligible);
  if (!best) return [];

  const amount = Math.min(capacity, effectiveAvailable(best.slot), space);
  const fillRatio = amount / capacity;

  if (fillRatio < minimumFill) {
    return [formatBelowMinFillLine(wareLabel, amount, capacity, fillRatio)];
  }
  return [`<div class="is-ready">${wareLabel} <span class="log-num">${formatQuantity(amount)}</span> ← ${nationColoredCodeSpan(best.station.nation)} <span class="log-ware">${best.station.name}</span> <span class="log-dim">(${eligible.length} src)</span></div>`];
}

/** Log for idle ships — explains why each ware is or isn't tradeable. */
function formatIdleTradeLog(ship: TradeShip, shipTemplate: ShipTemplate, manager: TradeManager, currentTime: number): string {
  // Idle ships with no home can't report tradeability — show a blocked
  // notice instead of throwing.
  const home = manager.stationResolver(ship.homeStationId);
  if (!home) return `<span class="is-blocked">Home station unavailable</span>`;
  const producedWares = new Set(home.stationType.produces);
  const allowed = shipTemplate.allowedWares;

  const idleElapsed = ship.idleStartTime > 0 ? currentTime - ship.idleStartTime : 0;
  const minimumFill = Math.max(0, economyConfig.minimumCargoFillThreshold - idleElapsed * economyConfig.cargoFillDecayPerSecond);
  const capacity = shipTemplate.cargoCapacity;

  const parts: string[] = [];
  if (minimumFill > 0) {
    parts.push(`<div class="log-head">Trader wants to fill at least ${formatPercent(minimumFill)} of cargo space</div>`);
  }

  for (const slot of getAllInventorySlots(home)) {
    const isAllowed = allowed.includes(slot.ware.id);
    const isOutput = producedWares.has(slot.ware.id);

    let groupLines: string[];
    if (!isAllowed) {
      const action = isOutput ? "sell" : "buy";
      const wareLabel = `<span class="log-ware">${slot.ware.name}</span> <span class="log-dim">(${action}):</span>`;
      groupLines = [`<div>${wareLabel}<span class="log-tail"> not in allowed wares</span></div>`];
    } else if (isOutput) {
      groupLines = formatSellWareLog(slot, home, capacity, minimumFill, manager);
    } else {
      groupLines = formatBuyWareLog(slot, home, capacity, minimumFill, manager);
    }

    parts.push(`<div class="log-group">${groupLines.join("")}</div>`);
  }

  return parts.join("");
}
