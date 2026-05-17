export const AUTOSAVE_INTERVAL_SECONDS = 120;
export const MANUAL_SLOT_COUNT = 3;
export const AUTO_SLOT_COUNT = 3;

export const SAVE_KEY_PREFIX = "skyshift.save";

export type SlotKind = "manual" | "auto";

/** One shared slot set across all presets — M1/M2/M3/A1/A2/A3 are reused
 *  regardless of which preset seeded the run. `GameSnapshot.presetId` is a
 *  breadcrumb only; nothing routes loads by it. */
export function saveSlotKey(kind: SlotKind, index: number): string {
  return `${SAVE_KEY_PREFIX}.${kind}.${index}`;
}
export function autoSaveNextIndexKey(): string {
  return `${SAVE_KEY_PREFIX}.auto.nextIndex`;
}
