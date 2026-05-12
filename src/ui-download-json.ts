/** Shared JSON-file download for save-game export and the Timelapse tab's
 *  diagnostics export — route both through here so MIME and filename
 *  conventions stay consistent. */
export function downloadJsonFile(payload: unknown, filename: string): void {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const downloadAnchor = document.createElement("a");
  downloadAnchor.href = url;
  downloadAnchor.download = filename;
  downloadAnchor.click();
  URL.revokeObjectURL(url);
}

/** ISO timestamp safe for filenames — colons and dots become dashes so OSes
 *  that disallow them in filenames don't choke. */
export function fileNameTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}
