// Toast — short notifications styled as .id-card to match the HUD. A
// singleton .toast-root spawns lazily and stacks .toast-item children;
// CSS positions the root.

import { toastVisuals } from "../data/visuals-toast";

let toastRoot: HTMLElement | null = null;

/** Hides the in-world selection indicator while a blocking toast is up so
 *  the ring doesn't compete with the toast for attention. Non-blocking
 *  toasts skip this. game.ts registers the callback. */
type SelectionVisibilityCallback = (hidden: boolean) => void;
let selectionVisibilityCallback: SelectionVisibilityCallback | null = null;
let activeBlockingToasts = 0;

export function registerToastSelectionHook(callback: SelectionVisibilityCallback | null): void {
  selectionVisibilityCallback = callback;
  // Scene teardown passes null to disown — reset the counter so the next
  // scene's first blocking toast re-triggers the hide instead of being
  // skipped from a stale carry-over.
  if (callback === null) activeBlockingToasts = 0;
}

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
  /** Adds a dimming backdrop; for errors the player must acknowledge.
   *  Still auto-dismisses. */
  blocking?: boolean;
}

/** Auto-dismisses after toastVisuals.durationMilliseconds; safe to call repeatedly — each toast clears on its own timer. */
export function showToast(message: string, options: ToastOptions = {}): void {
  const root = ensureToastRoot();

  const item = document.createElement("div");
  item.className = "toast-item id-card";
  if (options.ok) item.classList.add("toast--ok");
  if (options.blocking) item.classList.add("toast--blocking");
  item.textContent = message;
  root.appendChild(item);

  if (options.blocking) openBlockingToast(root);

  // Fade out slightly before removal so the transition lands as the node detaches.
  window.setTimeout(() => {
    item.classList.add("toast-item--fading");
  }, toastVisuals.durationMilliseconds - toastVisuals.fadeMilliseconds);
  window.setTimeout(() => {
    item.remove();
    if (options.blocking) closeBlockingToast(root);
  }, toastVisuals.durationMilliseconds);
}

/** A counter handles overlap — the ring stays hidden until the last blocking
 *  toast clears. The dim backdrop is also driven by the counter. */
function openBlockingToast(root: HTMLElement): void {
  activeBlockingToasts++;
  if (activeBlockingToasts === 1) selectionVisibilityCallback?.(true);
  root.classList.toggle("toast-root--blocking", activeBlockingToasts > 0);
}

function closeBlockingToast(root: HTMLElement): void {
  activeBlockingToasts = Math.max(0, activeBlockingToasts - 1);
  if (activeBlockingToasts === 0) selectionVisibilityCallback?.(false);
  root.classList.toggle("toast-root--blocking", activeBlockingToasts > 0);
}
