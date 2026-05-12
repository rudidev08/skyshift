export function loadKeyValueSetting(key: string, defaultValue: string): string {
  return localStorage.getItem(key) ?? defaultValue;
}

export function saveKeyValueSetting(key: string, value: string): void {
  localStorage.setItem(key, value);
}
