// Toast — short notifications styled as .id-card to match the HUD. A
// singleton .toast-root spawns lazily and stacks .toast-item children.

import { toastVisuals } from "../data/visuals-toast";

let toastRoot: HTMLElement | null = null;

function ensureToastRoot(): HTMLElement {
  if (toastRoot && toastRoot.isConnected) return toastRoot;
  const root = document.createElement("div");
  root.className = "toast-root";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  document.body.appendChild(root);
  toastRoot = root;
  return root;
}

export interface ToastOptions {
  /** Success variant — green accent instead of neutral. */
  ok?: boolean;
}

/** Shows a toast that auto-dismisses after toastVisuals.durationSeconds. Each call creates independent dismiss timers, so stacking multiple toasts works correctly. */
export function showToast(message: string, options: ToastOptions = {}): void {
  const root = ensureToastRoot();

  const item = document.createElement("div");
  item.className = "toast-item id-card";
  if (options.ok) item.classList.add("toast--ok");
  item.textContent = message;
  root.appendChild(item);

  const fadeStartDelayMilliseconds = (toastVisuals.durationSeconds - toastVisuals.fadeSeconds) * 1000;
  window.setTimeout(() => {
    item.classList.add("toast-item--fading");
  }, fadeStartDelayMilliseconds);
  window.setTimeout(() => {
    item.remove();
  }, toastVisuals.durationSeconds * 1000);
}
