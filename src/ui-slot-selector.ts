// Owns the two-step pending/confirm flow for destructive load/overwrite, plus
// immediate-save for empty manual slots. Caller owns save/load I/O via
// callbacks; this class only renders the picker.

import { X } from "lucide-static";
import { listSlots, type SlotSummary } from "./storage-save-slots";
import { type ValidationResult } from "./ui-savegame-manager";
import { getPresetLabel } from "./util-map-preset";
import { formatLocalDateTime } from "./util-date-format";

const PENDING_TIMEOUT_MS = 1500;

export interface SlotSelectorOptions {
  slotList: HTMLElement;
  actionBar: HTMLElement;
  /** Callback owns the write + toasting; selector only re-renders after. */
  onSave(slot: SlotSummary): void;
  /** Returns ValidationResult so errors flow through the same handler as file-import. */
  onLoad(slot: SlotSummary): ValidationResult;
  /** Typically close the panel on success, show a toast on failure. */
  onLoadResult(result: ValidationResult): void;
}

export class SlotSelector {
  private readonly options: SlotSelectorOptions;
  private selectedSlot: SlotSummary | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: SlotSelectorOptions) {
    this.options = options;
  }

  /** Re-reads listSlots() so savedAt timestamps reflect the latest write. */
  refresh(): void {
    const slots = listSlots();
    this.selectedSlot = this.selectedSlot
      ? (slots.find((slot) => isSameSlot(slot, this.selectedSlot)) ?? null)
      : null;

    const { slotList } = this.options;
    slotList.innerHTML = "";
    for (const slot of slots) {
      if (slot.kind === "auto" && slot.savedAt === null) continue;
      slotList.appendChild(this.createSlotRow(slot));
    }

    this.renderActionBar();
  }

  private createSlotRow(slot: SlotSummary): HTMLButtonElement {
    const isEmpty = slot.savedAt === null;
    const row = document.createElement("button");
    row.type = "button";
    row.className = "slot-row";
    if (isSameSlot(slot, this.selectedSlot)) {
      row.classList.add("is-selected");
    }
    // Slots are shared across maps — label shows the saved universe (the
    // M/A prefix on slot-num already encodes the kind). Falls back to
    // Manual/Auto when empty or when a save lacks a preset field.
    const kindLabel = slot.kind === "manual" ? "Manual" : "Auto";
    const slotLabel = isEmpty || !slot.presetId ? kindLabel : getPresetLabel(slot.presetId);
    const numberLabel = `${slot.kind === "manual" ? "M" : "A"}${slot.index}`;
    const numberClass = isEmpty ? "slot-num is-empty" : `slot-num slot-num--${slot.kind}`;
    let timeText: string;
    if (isEmpty) {
      timeText = `<span class="slot-time-empty">Empty</span>`;
    } else {
      const { date, time } = formatLocalDateTime(new Date(slot.savedAt!));
      timeText = `<span class="slot-time-date">${date}</span><span class="slot-time-time">${time}</span>`;
    }
    row.innerHTML = `
      <span class="${numberClass}">${numberLabel}</span>
      <span class="slot-label">${slotLabel}</span>
      <span class="slot-time">${timeText}</span>
    `;
    row.addEventListener("click", () => {
      if (isSameSlot(slot, this.selectedSlot)) return;
      this.selectedSlot = slot;
      this.refresh();
    });
    return row;
  }

  /** Called on panel close so the next open starts with no selection or pending action. */
  clear(): void {
    this.resetPendingTimer();
    this.selectedSlot = null;
  }

  private resetPendingTimer(): void {
    if (!this.pendingTimer) return;
    clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
  }

  private handleEmptySlotSave(slot: SlotSummary): void {
    this.options.onSave(slot);
    this.renderActionBar();
  }

  private renderActionBar(): void {
    this.resetPendingTimer();
    const { actionBar } = this.options;
    actionBar.innerHTML = "";

    if (!this.selectedSlot) {
      actionBar.innerHTML = `<span class="slot-action-hint">Select a savegame to load or save</span>`;
      return;
    }

    const isEmpty = this.selectedSlot.savedAt === null;
    const slot = this.selectedSlot;

    if (slot.kind === "manual") {
      // Empty slot has nothing to clobber — save immediately. Overwriting
      // an occupied slot keeps the two-step guard since that IS destructive.
      const onClick = isEmpty ? () => this.handleEmptySlotSave(slot) : () => this.setActionPending("save");
      actionBar.appendChild(createHudButton(isEmpty ? "Save" : "Overwrite", onClick));
    }
    if (!isEmpty) {
      actionBar.appendChild(createHudButton("Load", () => this.setActionPending("load")));
    }
  }

  private setActionPending(action: "save" | "load"): void {
    if (!this.selectedSlot) return;
    const slot = this.selectedSlot;
    const { actionBar } = this.options;
    actionBar.innerHTML = `<span class="slot-pending">···</span>`;
    this.pendingTimer = setTimeout(() => this.showConfirmButtons(action, slot), PENDING_TIMEOUT_MS);
  }

  private showConfirmButtons(action: "save" | "load", slot: SlotSummary): void {
    const { actionBar } = this.options;
    actionBar.innerHTML = "";
    const confirmButton = createHudButton(
      action === "save" ? "Confirm save?" : "Confirm load?",
      () => {
        if (action === "save") {
          this.options.onSave(slot);
          this.renderActionBar();
        } else {
          this.options.onLoadResult(this.options.onLoad(slot));
        }
      },
      "slot-confirm",
    );
    const cancelButton = document.createElement("button");
    cancelButton.className = "hud-btn";
    cancelButton.innerHTML = X;
    cancelButton.addEventListener("click", () => this.renderActionBar());
    actionBar.appendChild(confirmButton);
    actionBar.appendChild(cancelButton);
  }
}

function isSameSlot(leftSlot: SlotSummary | null, rightSlot: SlotSummary | null): boolean {
  return !!leftSlot && !!rightSlot && leftSlot.kind === rightSlot.kind && leftSlot.index === rightSlot.index;
}

function createHudButton(label: string, onClick: () => void, extraClass?: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = extraClass ? `hud-btn ${extraClass}` : "hud-btn";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}
