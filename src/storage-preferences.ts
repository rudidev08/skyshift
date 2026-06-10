// Preference get/set over localStorage. The guarded access helpers in
// storage-local handle storage being blocked (Safari private mode, privacy or
// enterprise blocking) — reads fall back to the default, writes quietly skip.

import { readLocalStorage, tryWriteLocalStorage } from "./storage-local";

export function loadPreference(key: string, defaultValue: string): string {
  return readLocalStorage(key) ?? defaultValue;
}

export function savePreference(key: string, value: string): void {
  tryWriteLocalStorage(() => localStorage.setItem(key, value));
}
