// localStorage save-slot reader/wiper. Imports only slot-key constants from
// sim-save-slots — no Phaser, no game runtime — so the static landing page can
// read slot breadcrumbs and the load-error page can wipe slots without pulling
// in the simulator.
import {
  AUTO_SLOT_COUNT,
  MANUAL_SLOT_COUNT,
  autoSaveNextIndexKey,
  saveSlotKey,
  type SlotKind,
} from "./sim-save-slots";

export type SlotSource = "auto" | "manual" | "export";

export interface SlotSummary {
  kind: SlotKind;
  index: number;
  savedAt: number | null; // null = empty
  /** Preset id the run was seeded from — display breadcrumb only, not used for loading. */
  presetId: string | null;
  source: SlotSource | null;
}

function emptySlotSummary(kind: SlotKind, index: number): SlotSummary {
  return { kind, index, savedAt: null, presetId: null, source: null };
}

const SLOT_SOURCES: ReadonlySet<SlotSource> = new Set<SlotSource>(["auto", "manual", "export"]);

interface SlotSummaryFields {
  savedAt: number | null;
  presetId: string | null;
  source: SlotSource | null;
}

/** Narrow parsed JSON from localStorage to the three SlotSummary display fields,
 *  or null if any field has the wrong type. The slot blob in localStorage is the
 *  full GameSnapshot — this only validates the breadcrumb fields the slot picker
 *  reads; full snapshot validation lives in `validateSnapshot`. */
function validateSlotSummary(parsed: unknown): SlotSummaryFields | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  const savedAt = obj.savedAt;
  if (savedAt !== undefined && savedAt !== null && typeof savedAt !== "number") return null;

  const presetId = obj.presetId;
  if (presetId !== undefined && presetId !== null && typeof presetId !== "string") return null;

  const source = obj.source;
  if (
    source !== undefined &&
    source !== null &&
    (typeof source !== "string" || !SLOT_SOURCES.has(source as SlotSource))
  )
    return null;

  return {
    savedAt: savedAt ?? null,
    presetId: presetId ?? null,
    source: (source as SlotSummaryFields["source"]) ?? null,
  };
}

export function readSlotSummary(kind: SlotKind, index: number): SlotSummary {
  const fields = readValidatedSlotFields(saveSlotKey(kind, index));
  return fields === null ? emptySlotSummary(kind, index) : { kind, index, ...fields };
}

function readValidatedSlotFields(storageKey: string): SlotSummaryFields | null {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return null;
  try {
    return validateSlotSummary(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function listSlots(): SlotSummary[] {
  const summaries: SlotSummary[] = [];
  for (let i = 1; i <= MANUAL_SLOT_COUNT; i++) summaries.push(readSlotSummary("manual", i));
  for (let i = 1; i <= AUTO_SLOT_COUNT; i++) summaries.push(readSlotSummary("auto", i));
  return summaries;
}

/** Most recently written slot across manual + auto, or null if no saves exist.
 *  Drives the landing page's "Continue saved" CTA. */
export function findLatestSave(): SlotSummary | null {
  const savedSlots = listSlots().filter(isSavedSlot);
  if (savedSlots.length === 0) return null;
  return savedSlots.reduce((latest, slot) => (slot.savedAt > latest.savedAt ? slot : latest));
}

function isSavedSlot(slot: SlotSummary): slot is SlotSummary & { savedAt: number } {
  return slot.savedAt !== null;
}

export function getNextAutoIndex(): number {
  const raw = localStorage.getItem(autoSaveNextIndexKey());
  const parsed = raw ? parseInt(raw, 10) : 1;
  if (parsed >= 1 && parsed <= AUTO_SLOT_COUNT) return parsed;
  return 1;
}

/** Wipe every manual + auto save slot and the auto-rotation cursor. Used by
 *  the load-error page's "Clear saves" recovery so a corrupt-latest player can
 *  get back to a working landing without DevTools. Leaves other localStorage
 *  keys (settings, viewMode, etc.) alone. */
export function clearAllSaves(): void {
  for (let i = 1; i <= MANUAL_SLOT_COUNT; i++) {
    localStorage.removeItem(saveSlotKey("manual", i));
  }
  for (let i = 1; i <= AUTO_SLOT_COUNT; i++) {
    localStorage.removeItem(saveSlotKey("auto", i));
  }
  localStorage.removeItem(autoSaveNextIndexKey());
}
