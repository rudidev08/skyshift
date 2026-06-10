// Trade sidebar — DOM-only controls for the overview's Trading tab.
//
// One control: a ware dropdown that picks which ware drives the green accent
// on the trade-route overlay. Rows show per-ware shipment totals for the last 2h.

import { ChevronDown } from "lucide-static";
import type { WareTemplate } from "../data/ware-types";
import type { WareId } from "../data/ware-types";
import { createWareSidebar } from "./ui-overview-sidebar-shell";
import { getWareTemplate } from "./sim-ware-template";
import { shieldDomSurfaceFromPhaserInput } from "./ui-dom-input-shield";
import type { WareSelection } from "./phaser/overview-trade-render";
import { setTextIfChanged } from "./ui-dom-cache";
import { formatTradeMagnitude } from "./util-quantity-format";

const NONE_LABEL = "None";

function formatTradeTotal(tradeTotal: number): string {
  if (tradeTotal === 0) return "0";
  return formatTradeMagnitude(tradeTotal);
}

/** Show the 2h shipment total next to a ware, hidden for the "none" row. */
function applyWareCount(
  countElement: HTMLElement,
  selection: WareSelection,
  totals: Map<WareId, number>,
): void {
  if (selection === "none") {
    setTextIfChanged(countElement, "");
    countElement.hidden = true;
    return;
  }
  countElement.hidden = false;
  setTextIfChanged(countElement, formatTradeTotal(totals.get(selection) ?? 0));
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

export function createOverviewTradeSidebar(options: OverviewTradeSidebarOptions): OverviewTradeSidebar {
  const { parent, tradeableWares, onSelectionChange } = options;

  const shell = createWareSidebar(parent, "Overview");
  const sidebar = shell.sidebar;
  const head = document.createElement("div");
  head.className = "ware-sidebar-head";
  head.textContent = "Overview";
  sidebar.appendChild(head);
  const sortedWares = [...tradeableWares].sort((wareA, wareB) => wareA.name.localeCompare(wareB.name));
  const hasTradeableWares = sortedWares.length > 0;

  let selectedWare: WareSelection = "none";
  let dropdownOpen = false;
  let wareTradeTotals: Map<WareId, number> = new Map();

  function syncDropdownToState(): void {
    if (!wareDropdown) return;
    const { rootElement, triggerLabel, triggerCount, wareRows } = wareDropdown;
    rootElement.classList.toggle("is-open", dropdownOpen);
    const triggerLabelText =
      selectedWare === "none" ? NONE_LABEL : getWareTemplate(selectedWare).name;
    setTextIfChanged(triggerLabel, triggerLabelText);
    applyWareCount(triggerCount, selectedWare, wareTradeTotals);
    for (const row of wareRows.values()) {
      row.row.classList.toggle("is-selected", row.selection === selectedWare);
      applyWareCount(row.count, row.selection, wareTradeTotals);
    }
  }

  const wareDropdown = hasTradeableWares
    ? appendWareDropdown({
        sidebar,
        sortedWares,
        onWareSelect(ware) {
          selectedWare = ware;
          dropdownOpen = false;
          syncDropdownToState();
          onSelectionChange(ware);
        },
        onTriggerToggle() {
          dropdownOpen = !dropdownOpen;
          syncDropdownToState();
        },
      })
    : null;
  if (!wareDropdown) appendEmptyWareSection(sidebar);

  const detachInputShield = shieldDomSurfaceFromPhaserInput(sidebar);
  const detachOutsideClick = closeDropdownOnOutsideClick({
    dropdown: wareDropdown?.rootElement ?? null,
    isOpen: () => dropdownOpen,
    closeDropdown() {
      dropdownOpen = false;
      syncDropdownToState();
    },
  });

  syncDropdownToState();

  return {
    setWareTotals(totals: Map<WareId, number>): void {
      wareTradeTotals = totals;
      syncDropdownToState();
    },
    closeDropdown(): void {
      if (!dropdownOpen) return;
      dropdownOpen = false;
      syncDropdownToState();
    },
    destroy(): void {
      detachOutsideClick();
      detachInputShield();
      shell.destroy();
    },
  };
}

function appendWareDropdown(input: {
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
  appendWareRow({ menu, wareRows, selection: "none", label: NONE_LABEL, onWareSelect });
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
