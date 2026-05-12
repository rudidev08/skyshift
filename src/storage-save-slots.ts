// Lightweight localStorage helpers for save slots. Imports only sim-save-types
// — no game, Phaser, or sim dependencies — so it's safe to use from the static landing
// page as well as the game runtime.
import {
  AUTO_SLOT_COUNT,
  MANUAL_SLOT_COUNT,
  autoSaveNextIndexKey,
  saveSlotKey,
  type SlotKind,
} from "./sim-save-types";

export interface SlotSummary {
  kind: SlotKind;
  index: number;
  savedAt: number | null;  // null = empty
  /** Preset id the run was seeded from — display breadcrumb only, not used for loading. */
  preset: string | null;
  source: "auto" | "manual" | "export" | null;
}

function emptySlotSummary(kind: SlotKind, index: number): SlotSummary {
  return { kind, index, savedAt: null, preset: null, source: null };
}

const SLOT_SOURCES: ReadonlySet<string> = new Set(["auto", "manual", "export"]);

interface SlotSummaryFields {
  savedAt: number | null;
  preset: string | null;
  source: "auto" | "manual" | "export" | null;
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

  const preset = obj.preset;
  if (preset !== undefined && preset !== null && typeof preset !== "string") return null;

  const source = obj.source;
  if (source !== undefined && source !== null && (typeof source !== "string" || !SLOT_SOURCES.has(source))) return null;

  return {
    savedAt: savedAt ?? null,
    preset: preset ?? null,
    source: (source as SlotSummaryFields["source"]) ?? null,
  };
}

export function readSlotSummary(kind: SlotKind, index: number): SlotSummary {
  const raw = localStorage.getItem(saveSlotKey(kind, index));
  if (!raw) return emptySlotSummary(kind, index);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch { return emptySlotSummary(kind, index); }
  const fields = validateSlotSummary(parsed);
  if (!fields) return emptySlotSummary(kind, index);
  return { kind, index, ...fields };
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
  let latest: SlotSummary | null = null;
  for (const slot of listSlots()) {
    if (slot.savedAt === null) continue;
    if (!latest || latest.savedAt! < slot.savedAt) latest = slot;
  }
  return latest;
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
