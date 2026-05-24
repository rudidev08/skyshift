// HUD-facing display helpers for trade ships: status label, the cargo-grid
// description rendered in the info card, the predicates the ship visual
// bundle uses to gate selection / idle states, and the multi-line trade
// log shown in the expandable log panel.
//
// Pure read-only formatters — every entry takes a TradeShip + the live
// TradeManager + currentTimeSeconds; resolvers and the trade clock flow
// through the manager. Don't mutate sim state here; the manager and queue
// files own the writes.

import { economyConfig } from "../data/economy-config";
import type { WareId } from "../data/ware-types";
import type { TradeDirection } from "./sim-trade-types";
import { getInventorySlot, getAllInventorySlots, type Station, type InventorySlot } from "./sim-station";
import { stationCodeNameLabel } from "./sim-station-template";
import { getShipTypeTemplate } from "./sim-ship-template";
import { getWareTemplate } from "./sim-ware-template";
import type { ShipTypeTemplate } from "../data/ship-types";
import type { ShipAction } from "./sim-travel-types";
import { formatQuantity, formatDuration, formatCargoBar, formatPercent } from "./util-quantity-format";
import { nationColoredCodeSpan } from "./sim-nation-code-format";
import { type TradeShip } from "./sim-trade-types";
import type { TradeManager } from "./sim-trade-manager";
import {
  effectiveAvailable,
  effectiveSpace,
  effectiveFillPercent,
  scoreForDirection,
} from "./sim-trade-decision";

/** Player-selectable when idle or on an inter-station flight; not selectable while deploying. */
export function isTradeShipSelectable(ship: TradeShip): boolean {
  if (isTradeShipIdle(ship)) return true;
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
  if (isTradeShipIdle(ship)) return false;
  const current = ship.actionQueue[0];
  return current.type === "fly" && current.deploying === true;
}

/** "BIO Bloomreach" with only the nation code tinted. */
function formatStationLabelHtml(station: Station): string {
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
  if (isTradeShipIdle(ship)) return "Looking for Traders";
  if (isTradeShipDeploying(ship)) return "Deploying";
  const current = ship.actionQueue[0];
  if (current.type === "fly") return "Flying";
  return "Trading";
}

/** Empty cargo bar shown for ships with nothing in the hold or still deploying. */
function formatEmptyCargoBar(capacity: number): string {
  return formatCargoBar({ wareName: "No Cargo", current: 0, max: capacity });
}

/** Seconds since the ship's last trade, or 0 if it has never traded
 *  (`idleSinceTradeTimeSeconds` stays 0 until the first trade completes). */
function idleElapsedSeconds(ship: TradeShip, currentTimeSeconds: number): number {
  return ship.idleSinceTradeTimeSeconds > 0 ? currentTimeSeconds - ship.idleSinceTradeTimeSeconds : 0;
}

/** Idle ship — empty cargo bar plus "last trade Xs ago" when a previous trade has occurred. */
function formatIdleTradeShipDescription(ship: TradeShip, capacity: number, currentTimeSeconds: number): string {
  const cargoBar = formatEmptyCargoBar(capacity);
  const idleElapsed = idleElapsedSeconds(ship, currentTimeSeconds);
  if (idleElapsed <= 0) return cargoBar;
  const statusRow = buildCargoNote(
    "Status",
    `<span class="cargo-note-dim">Last trade ${formatDuration(idleElapsed)} ago</span>`,
  );
  return `${cargoBar}${statusRow}`;
}

/** Deploying ship — empty cargo bar plus "Deploying to <home>" status row. */
function formatDeployingTradeShipDescription(homeStation: Station | null, capacity: number): string {
  const cargoBar = formatEmptyCargoBar(capacity);
  const destinationLabel = homeStation ? formatStationLabelHtml(homeStation) : "home";
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
export function formatActiveActionNote(currentAction: ShipAction): string {
  switch (currentAction.type) {
    case "fly":
      if (currentAction.isTradeFlight) {
        return buildCargoNote(
          "Route",
          `${formatStationLabelHtml(currentAction.originStation)} <span class="cargo-note-dim">to</span><br>${formatStationLabelHtml(currentAction.destinationStation)}`,
        );
      }
      return buildCargoNote("Status", currentAction.label);
    case "wait":
      return buildCargoNote("Status", currentAction.label);
    case "cargo-withdrawal":
    case "cargo-deposit":
      return buildCargoNote("Status", `Transferring cargo at ${stationCodeNameLabel(currentAction.station)}`);
    case "decommission":
      return buildCargoNote("Status", currentAction.label);
  }
}

/** Info-panel HTML for a trade ship. Injected into `.cargo-grid` — bare grid
 *  children (label / track / stat) plus optional cargo-note rows, no wrapper. */
export function getTradeShipDescription(
  ship: TradeShip,
  manager: TradeManager,
  currentTimeSeconds: number,
): string {
  // Home may be missing for emigrating ships on a ferry-to-generational-ship
  // queue after home demolition; fall back so the panel still renders the cargo + label.
  const homeStation = manager.stationResolver(ship.homeStationId);
  const capacity = getShipTypeTemplate(manager.requireResolvedShip(ship.orbitingShipId).shipTypeId).cargoCapacity;

  if (isTradeShipIdle(ship)) return formatIdleTradeShipDescription(ship, capacity, currentTimeSeconds);
  if (isTradeShipDeploying(ship)) return formatDeployingTradeShipDescription(homeStation ?? null, capacity);

  const cargoBars = formatActiveCargoBars(ship, capacity);
  const note = formatActiveActionNote(ship.actionQueue[0]);
  return `${cargoBars}${note}`;
}

// Line colors live in `.log-panel-body .is-*` in ui.css; formatters here only set the `is-*` class.

function formatActionLogLine(action: ShipAction): string {
  switch (action.type) {
    case "fly":
      return action.label;
    case "wait":
      return action.label;
    case "cargo-withdrawal":
      return `Load: ${formatQuantity(action.amount)} ${action.wareId}`;
    case "cargo-deposit":
      return `Deliver: ${formatQuantity(action.amount)} ${action.wareId}`;
    case "decommission":
      return action.label;
  }
}

/** Concise trade-state explanation for the log panel. */
export function getTradeLog(ship: TradeShip, manager: TradeManager, currentTimeSeconds: number): string {
  const shipTemplate = getShipTypeTemplate(manager.requireResolvedShip(ship.orbitingShipId).shipTypeId);
  if (shipTemplate.cargoCapacity === 0) return `<span class="is-blocked">Ship has no cargo capacity</span>`;
  if (isTradeShipDeploying(ship)) return `<span class="is-blocked">Deploying — not yet trading</span>`;
  if (ship.actionQueue.length > 0) return formatActiveTradeLog(ship, manager);
  return formatIdleTradeLog(ship, shipTemplate, manager, currentTimeSeconds);
}

/** Buy/Sell summary line plus From/To station rows with fill levels, and Bonus rows for any extra cargo.
 *  Empty when home or target station is gone (mid-ferry emigration) — caller still renders the action queue. */
function formatActiveTradeSummary(ship: TradeShip, manager: TradeManager): string[] {
  const home = manager.stationResolver(ship.homeStationId);
  const targetStation = ship.targetStationId ? (manager.stationResolver(ship.targetStationId) ?? null) : null;
  const primaryEntry = ship.cargoAmountByWareId.entries().next().value;
  if (!home || !primaryEntry || !targetStation) return [];

  const [primaryWareId] = primaryEntry;
  const primaryWare = getWareTemplate(primaryWareId);
  const sourceStation = ship.tradeDirection === "sell" ? home : targetStation;
  const destinationStation = ship.tradeDirection === "sell" ? targetStation : home;
  const sourceSlot = getInventorySlot(sourceStation, primaryWareId);
  const destinationSlot = getInventorySlot(destinationStation, primaryWareId);

  const actionLabel = ship.tradeDirection === "sell" ? "Selling" : "Buying";

  const lines: string[] = [];
  lines.push(`<span class="is-label">${actionLabel}:</span> ${primaryWare.name}`);

  if (sourceSlot) {
    lines.push(
      `<span class="is-label">From:</span> ${stationCodeNameLabel(sourceStation)} ${formatPercent(effectiveFillPercent(sourceSlot))} filled (${formatQuantity(sourceSlot.current)}/${formatQuantity(sourceSlot.max)})`,
    );
  }
  if (destinationSlot) {
    lines.push(
      `<span class="is-label">To:</span> ${stationCodeNameLabel(destinationStation)} ${formatPercent(effectiveFillPercent(destinationSlot))} filled (${formatQuantity(destinationSlot.current)}/${formatQuantity(destinationSlot.max)})`,
    );
  }

  for (const [extraWareId, extraAmount] of ship.cargoAmountByWareId) {
    if (extraWareId === primaryWareId) continue;
    const extraWare = getWareTemplate(extraWareId);
    lines.push(
      `<span class="is-label">Bonus:</span> ${extraWare.name} (${formatQuantity(extraAmount)} on ship)`,
    );
  }

  return lines;
}

/** One line per queued action; the head of the queue is prefixed with ▸ and styled as the current step. */
function formatActionQueueWithCurrentSelected(ship: TradeShip): string[] {
  const lines: string[] = [];
  for (let i = 0; i < ship.actionQueue.length; i++) {
    const prefix = i === 0 ? "▸ " : "  ";
    const className = i === 0 ? "is-current" : "is-blocked";
    lines.push(`<span class="${className}">${prefix}${formatActionLogLine(ship.actionQueue[i])}</span>`);
  }
  return lines;
}

/** Log for ships on an active trade run — trade summary plus action plan. */
function formatActiveTradeLog(ship: TradeShip, manager: TradeManager): string {
  return [...formatActiveTradeSummary(ship, manager), ...formatActionQueueWithCurrentSelected(ship)].join(
    "<br>",
  );
}

/** Counterpart station paired with the slot evaluated and the score used to
 *  rank near-misses for display (demand for sell, supply for buy). */
interface ScoredCandidate {
  station: Station;
  slot: InventorySlot;
  score: number;
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

/** Score every counterpart once and partition into eligible (beats home's
 *  score — what the trade decision would pick) and the top 3 fallbacks
 *  (highest-scoring near-misses). Mirrors pickDestinationStation's filter so
 *  the log matches what trade decisions actually fire. */
function scoreCounterparts(
  slot: InventorySlot,
  home: Station,
  manager: TradeManager,
  direction: TradeDirection,
): { eligible: ScoredCandidate[]; fallbacks: ScoredCandidate[] } {
  const scoreForSlot = scoreForDirection(direction);
  const homeScore = scoreForSlot(home, slot);
  const eligible: ScoredCandidate[] = [];
  const fallbacks: ScoredCandidate[] = [];
  for (const station of counterpartStations(manager, slot.ware.id, direction)) {
    if (station === home) continue;
    const counterpartSlot = getInventorySlot(station, slot.ware.id);
    if (!counterpartSlot) continue;
    const score = scoreForSlot(station, counterpartSlot);
    if (score > homeScore) eligible.push({ station, slot: counterpartSlot, score });
    else fallbacks.push({ station, slot: counterpartSlot, score });
  }
  fallbacks.sort((a, b) => b.score - a.score);
  return { eligible, fallbacks: fallbacks.slice(0, 3) };
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
function formatFallbackBlock(
  slot: InventorySlot,
  candidates: ScoredCandidate[],
  wareLabel: string,
  missingMessage: string,
): string[] {
  const homeFill = effectiveFillPercent(slot);
  const tail =
    candidates.length === 0
      ? `, ${missingMessage}`
      : `, ${missingMessage}, ${candidates.length} most eligible:`;
  const lines: string[] = [];
  lines.push(
    `<div>${wareLabel} <span class="log-num">${formatPercent(homeFill)}</span> <span class="log-dim">${slotDetails(slot)}</span><span class="log-tail">${tail}</span></div>`,
  );
  for (const candidate of candidates) {
    lines.push(formatSubRow(candidate.station, candidate.slot));
  }
  return lines;
}

/** Ware name plus the sell/buy tag, e.g. `Water (sell):` — the shared prefix
 *  every idle-log status line and the disallowed-ware line start with. */
function formatWareLogLabel(wareName: string, sellOrBuy: "sell" | "buy"): string {
  return `<span class="log-ware">${wareName}</span> <span class="log-dim">(${sellOrBuy}):</span>`;
}

/** No-availability log line — selling with no surplus, or buying with a full slot. */
function formatNoAvailabilityLine(slot: InventorySlot, wareLabel: string, isSell: boolean): string {
  const noGateMessage = isSell ? "no surplus" : "full";
  return `<div>${wareLabel}<span class="log-tail"> ${noGateMessage}</span> <span class="log-dim">${slotDetails(slot)}</span></div>`;
}

/** Below-min-fill log line — quantity available, percent of capacity it'd fill, and the threshold note. */
function formatBelowMinFillLine(
  wareLabel: string,
  amount: number,
  capacity: number,
  fillRatio: number,
): string {
  return `<div>${wareLabel} <span class="log-num">${formatQuantity(amount)}/${formatQuantity(capacity)}</span> <span class="log-dim">(${formatPercent(fillRatio)})</span><span class="log-tail"> below min fill</span></div>`;
}

/** Ready-to-ship log line — amount the trade would move and the chosen counterpart. */
function formatReadyToShipLine(
  wareLabel: string,
  amount: number,
  best: ScoredCandidate,
  eligibleCount: number,
  isSell: boolean,
): string {
  const arrow = isSell ? "→" : "←";
  const countLabel = isSell ? "dest" : "src";
  return `<div class="is-ready">${wareLabel} <span class="log-num">${formatQuantity(amount)}</span> ${arrow} ${nationColoredCodeSpan(best.station.nation)} <span class="log-ware">${best.station.name}</span> <span class="log-dim">(${eligibleCount} ${countLabel})</span></div>`;
}

interface IdleLogContext {
  home: Station;
  capacity: number;
  minimumFill: number;
  manager: TradeManager;
}

/** Idle-log block for one of home's inventory wares. Direction controls
 *  whether home is the source (sell — produces) or sink (buy — consumes);
 *  status branches: no surplus / full → no eligible counterpart (with
 *  fallback candidates) → below-min-fill → ready-to-ship. */
function formatTradeWareLog(
  slot: InventorySlot,
  context: IdleLogContext,
  direction: TradeDirection,
): string[] {
  const { home, capacity, minimumFill, manager } = context;
  const isSell = direction === "sell";
  const wareLabel = formatWareLogLabel(slot.ware.name, isSell ? "sell" : "buy");

  const homeAvailability = isSell ? effectiveAvailable(slot) : effectiveSpace(slot);
  if (homeAvailability <= 0) {
    return [formatNoAvailabilityLine(slot, wareLabel, isSell)];
  }

  const { eligible, fallbacks } = scoreCounterparts(slot, home, manager, direction);
  if (eligible.length === 0) {
    const noEligibleMessage = isSell ? "no destination needs it" : "no producer has surplus";
    return formatFallbackBlock(slot, fallbacks, wareLabel, noEligibleMessage);
  }

  const best = selectBestCounterpart(eligible);
  if (!best) return [];

  const sourceSlot = isSell ? slot : best.slot;
  const destinationSlot = isSell ? best.slot : slot;
  const amount = Math.min(capacity, effectiveAvailable(sourceSlot), effectiveSpace(destinationSlot));
  const fillRatio = amount / capacity;

  if (fillRatio < minimumFill) {
    return [formatBelowMinFillLine(wareLabel, amount, capacity, fillRatio)];
  }

  return [formatReadyToShipLine(wareLabel, amount, best, eligible.length, isSell)];
}

/** Log block for a ware the ship can't carry — the trader's allowedWares
 *  list excludes it, so it never trades regardless of fill. */
function formatDisallowedWareLog(slot: InventorySlot, isOutput: boolean): string[] {
  const wareLabel = formatWareLogLabel(slot.ware.name, isOutput ? "sell" : "buy");
  return [`<div>${wareLabel}<span class="log-tail"> not in allowed wares</span></div>`];
}

/** Log for idle ships — explains why each ware is or isn't tradeable. */
function formatIdleTradeLog(
  ship: TradeShip,
  shipTemplate: ShipTypeTemplate,
  manager: TradeManager,
  currentTimeSeconds: number,
): string {
  // Idle ships with no home can't report tradeability — show a blocked
  // notice instead of throwing.
  const home = manager.stationResolver(ship.homeStationId);
  if (!home) return `<span class="is-blocked">Home station unavailable</span>`;
  const producedWares = new Set(home.stationType.produces);
  const allowed = shipTemplate.allowedWares;

  const idleElapsed = idleElapsedSeconds(ship, currentTimeSeconds);
  const minimumFill = Math.max(
    0,
    economyConfig.minimumCargoFillThreshold - idleElapsed * economyConfig.cargoFillDecayPerSecond,
  );
  const capacity = shipTemplate.cargoCapacity;

  const parts: string[] = [];
  if (minimumFill > 0) {
    parts.push(
      `<div class="log-head">Trader wants to fill at least ${formatPercent(minimumFill)} of cargo space</div>`,
    );
  }

  for (const slot of getAllInventorySlots(home)) {
    const isAllowed = allowed.includes(slot.ware.id);
    const isOutput = producedWares.has(slot.ware.id);

    const context: IdleLogContext = { home, capacity, minimumFill, manager };
    const groupLines = isAllowed
      ? formatTradeWareLog(slot, context, isOutput ? "sell" : "buy")
      : formatDisallowedWareLog(slot, isOutput);

    parts.push(`<div class="log-group">${groupLines.join("")}</div>`);
  }

  return parts.join("");
}
