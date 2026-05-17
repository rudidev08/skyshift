// Trade sidebar — DOM-only controls for the overview's Trading tab.
//
// One control: a ware dropdown that picks which ware drives the green accent
// on the trade-route overlay. Rows show per-ware shipment totals for the last 2h.

import { ChevronDown } from "lucide-static";
import type { WareTemplate } from "../data/ware-types";
import type { WareId } from "../data/ware-types";
import { morseBarGradient } from "./render-morse-bar";
import { getWareTemplate } from "./sim-ware-template";
import { DOM_INPUT_SHIELD_EVENT_TYPES } from "./ui-dom-input-shield";
import { NONE, type WareSelection } from "./phaser/overview-trade-render";
import { setTextIfChanged } from "./ui-dom-cache";

const NONE_LABEL = "None";

function formatTradeTotal(tradeTotal: number): string {
  if (tradeTotal === 0) return "0";
  return tradeTotal < 10 ? tradeTotal.toFixed(1) : String(Math.round(tradeTotal));
}

export interface OverviewTradeSidebar {
  setWareTotals(totals: Map<WareId, number>): void;
  /** Reset the dropdown to closed when the Trading tab is hidden, so reopening the tab doesn't show a stale-open menu. */
  closeDropdown(): void;
  destroy(): void;
}

export interface OverviewTradeSidebarOptions {
  parent: HTMLElement;
  tradeableWares: WareTemplate[];
  onSelectionChange(ware: WareSelection): void;
}

interface WareRow {
  row: HTMLElement;
  selection: WareSelection;
  count: HTMLElement;
}

interface WareDropdown {
  rootElement: HTMLElement;
  triggerLabel: HTMLElement;
  triggerCount: HTMLElement;
  wareRows: Map<WareSelection, WareRow>;
}

/** Owns dropdown state (selected ware, open/closed, per-ware totals); every
 *  mutator pushes the new state to the DOM through sync(). */
interface WareDropdownState {
  setSelectedWare(ware: WareSelection): void;
  setOpen(open: boolean): void;
  toggleOpen(): void;
  setTotals(totals: Map<WareId, number>): void;
  isOpen(): boolean;
  sync(): void;
}

function createWareDropdownState(wareDropdown: WareDropdown | null): WareDropdownState {
  let selectedWare: WareSelection = NONE;
  let dropdownOpen = false;
  let wareTradeTotals: Map<WareId, number> = new Map();

  function sync(): void {
    if (!wareDropdown) return;
    const { rootElement, triggerLabel, triggerCount, wareRows } = wareDropdown;
    rootElement.classList.toggle("is-open", dropdownOpen);
    const triggerLabelText =
      selectedWare === NONE ? NONE_LABEL : getWareTemplate(selectedWare as WareId).name;
    setTextIfChanged(triggerLabel, triggerLabelText);
    if (selectedWare === NONE) {
      setTextIfChanged(triggerCount, "");
      triggerCount.hidden = true;
    } else {
      triggerCount.hidden = false;
      setTextIfChanged(triggerCount, formatTradeTotal(wareTradeTotals.get(selectedWare as WareId) ?? 0));
    }
    for (const row of wareRows.values()) {
      row.row.classList.toggle("is-selected", row.selection === selectedWare);
      if (row.selection === NONE) {
        setTextIfChanged(row.count, "");
        row.count.hidden = true;
        continue;
      }
      row.count.hidden = false;
      setTextIfChanged(row.count, formatTradeTotal(wareTradeTotals.get(row.selection as WareId) ?? 0));
    }
  }

  return {
    setSelectedWare(ware) {
      selectedWare = ware;
      sync();
    },
    setOpen(open) {
      dropdownOpen = open;
      sync();
    },
    toggleOpen() {
      dropdownOpen = !dropdownOpen;
      sync();
    },
    setTotals(totals) {
      wareTradeTotals = totals;
      sync();
    },
    isOpen() {
      return dropdownOpen;
    },
    sync,
  };
}

export function createOverviewTradeSidebar(options: OverviewTradeSidebarOptions): OverviewTradeSidebar {
  const { parent, tradeableWares, onSelectionChange } = options;
  parent.innerHTML = "";

  const sidebar = buildSidebarShell();
  const sortedWares = [...tradeableWares].sort((wareA, wareB) => wareA.name.localeCompare(wareB.name));
  const hasTradeableWares = sortedWares.length > 0;

  const wareDropdown = hasTradeableWares
    ? buildWareDropdown({
        sidebar,
        sortedWares,
        onWareSelect(ware) {
          dropdownState.setSelectedWare(ware);
          dropdownState.setOpen(false);
          onSelectionChange(ware);
        },
        onTriggerToggle() {
          dropdownState.toggleOpen();
        },
      })
    : null;
  if (!wareDropdown) appendEmptyWareSection(sidebar);
  const dropdownState = createWareDropdownState(wareDropdown);

  parent.appendChild(sidebar);

  const detachInputShield = shieldSidebarFromCanvasInput(sidebar);
  const detachOutsideClick = closeDropdownOnOutsideClick({
    dropdown: wareDropdown?.rootElement ?? null,
    isOpen: () => dropdownState.isOpen(),
    closeDropdown() {
      dropdownState.setOpen(false);
    },
  });

  dropdownState.sync();

  return {
    setWareTotals(totals: Map<WareId, number>): void {
      dropdownState.setTotals(totals);
    },
    closeDropdown(): void {
      if (!dropdownState.isOpen()) return;
      dropdownState.setOpen(false);
    },
    destroy(): void {
      detachOutsideClick();
      detachInputShield();
      parent.innerHTML = "";
    },
  };
}

function buildSidebarShell(): HTMLElement {
  const sidebar = document.createElement("div");
  sidebar.className = "ware-sidebar";
  sidebar.style.setProperty(
    "--morse-bar",
    morseBarGradient("Overview", { letterCount: 3, color: "var(--paper-mute)" }),
  );

  const head = document.createElement("div");
  head.className = "ware-sidebar-head";
  head.textContent = "Overview";
  sidebar.appendChild(head);
  return sidebar;
}

function buildWareDropdown(input: {
  sidebar: HTMLElement;
  sortedWares: WareTemplate[];
  onWareSelect(ware: WareSelection): void;
  onTriggerToggle(): void;
}): WareDropdown {
  const { sidebar, sortedWares, onWareSelect, onTriggerToggle } = input;

  const dropdown = document.createElement("div");
  dropdown.className = "ware-dropdown";
  const waresLabel = document.createElement("div");
  waresLabel.className = "ware-section-label";
  waresLabel.textContent = "Ware shipments in last 2h";
  dropdown.appendChild(waresLabel);

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "ware-dropdown-trigger";
  const triggerPrefix = document.createElement("span");
  triggerPrefix.className = "ware-prefix";
  triggerPrefix.textContent = "//";
  const triggerLabel = document.createElement("span");
  triggerLabel.className = "ware-label";
  const triggerCount = document.createElement("span");
  triggerCount.className = "ware-count";
  const triggerChevron = document.createElement("span");
  triggerChevron.className = "ware-dropdown-chevron";
  triggerChevron.innerHTML = ChevronDown;
  trigger.appendChild(triggerPrefix);
  trigger.appendChild(triggerLabel);
  trigger.appendChild(triggerCount);
  trigger.appendChild(triggerChevron);
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    onTriggerToggle();
  });
  dropdown.appendChild(trigger);

  const menu = document.createElement("div");
  menu.className = "ware-dropdown-menu";
  const wareRows = new Map<WareSelection, WareRow>();
  appendWareRow({ menu, wareRows, selection: NONE, label: NONE_LABEL, onWareSelect });
  for (const ware of sortedWares) {
    appendWareRow({ menu, wareRows, selection: ware.id, label: ware.name, onWareSelect });
  }
  dropdown.appendChild(menu);
  sidebar.appendChild(dropdown);
  return { rootElement: dropdown, triggerLabel, triggerCount, wareRows };
}

interface AppendWareRowOptions {
  menu: HTMLElement;
  wareRows: Map<WareSelection, WareRow>;
  selection: WareSelection;
  label: string;
  onWareSelect: (ware: WareSelection) => void;
}

function appendWareRow(options: AppendWareRowOptions): void {
  const { menu, wareRows, selection, label, onWareSelect } = options;
  const row = document.createElement("div");
  row.className = "ware-item";
  row.dataset.ware = selection;
  const prefix = document.createElement("span");
  prefix.className = "ware-prefix";
  prefix.textContent = "//";
  const labelElement = document.createElement("span");
  labelElement.className = "ware-label";
  labelElement.textContent = label;
  const count = document.createElement("span");
  count.className = "ware-count";
  row.appendChild(prefix);
  row.appendChild(labelElement);
  row.appendChild(count);
  row.addEventListener("click", (event) => {
    event.stopPropagation();
    onWareSelect(selection);
  });
  menu.appendChild(row);
  wareRows.set(selection, { row, selection, count });
}

function appendEmptyWareSection(sidebar: HTMLElement): void {
  const emptyState = document.createElement("div");
  emptyState.className = "ware-section";
  const emptyLabel = document.createElement("div");
  emptyLabel.className = "ware-section-label";
  emptyLabel.textContent = "Ware shipments in last 2h";
  const emptyMessage = document.createElement("div");
  emptyMessage.className = "ware-empty-state";
  emptyMessage.textContent = "No tradeable wares are available for this map's spawned fleet.";
  emptyState.append(emptyLabel, emptyMessage);
  sidebar.appendChild(emptyState);
}

/** Stop pointer/wheel events inside the sidebar from leaking into the Phaser map.
 *  Returns a teardown that detaches the listeners. */
function shieldSidebarFromCanvasInput(sidebar: HTMLElement): () => void {
  const stopEventPropagation = (event: Event) => event.stopPropagation();
  for (const eventType of DOM_INPUT_SHIELD_EVENT_TYPES) {
    sidebar.addEventListener(eventType, stopEventPropagation);
  }
  return () => {
    for (const eventType of DOM_INPUT_SHIELD_EVENT_TYPES) {
      sidebar.removeEventListener(eventType, stopEventPropagation);
    }
  };
}

/** Close the dropdown when the user clicks outside it (anywhere in the document
 *  including the canvas). Returns a teardown that removes the document handler. */
function closeDropdownOnOutsideClick(input: {
  dropdown: HTMLElement | null;
  isOpen: () => boolean;
  closeDropdown: () => void;
}): () => void {
  const { dropdown, isOpen, closeDropdown } = input;
  const onOutsideClick = (event: MouseEvent) => {
    if (!isOpen() || !dropdown) return;
    if (dropdown.contains(event.target as Node)) return;
    closeDropdown();
  };
  document.addEventListener("click", onOutsideClick);
  return () => document.removeEventListener("click", onOutsideClick);
}
