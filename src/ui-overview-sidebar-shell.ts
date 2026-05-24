// Shared chrome for the overview sidebar panes (Trading, Emigration, Log):
// a `.ware-sidebar` panel with the 3-letter morse-stripe top accent. Each
// pane fills in its own head and content; only the panel frame and the
// morse-stripe are shared.

import { morseBarGradient } from "./render-morse-bar";

/** A mounted `.ware-sidebar` panel plus the teardown that empties its root. */
export interface WareSidebarShell {
  /** The `.ware-sidebar` element, already appended into the pane root. */
  sidebar: HTMLDivElement;
  /** Empties the pane root. Call from the owning pane's teardown. */
  destroy(): void;
}

/** Clear `root`, mount a `.ware-sidebar` panel with `title`'s morse-stripe
 *  accent, and return it with a teardown. The pane appends its own head and
 *  content onto the returned `sidebar`. */
export function createWareSidebar(root: HTMLElement, title: string): WareSidebarShell {
  root.innerHTML = "";
  const sidebar = document.createElement("div");
  sidebar.className = "ware-sidebar";
  sidebar.style.setProperty(
    "--morse-bar",
    morseBarGradient(title, { letterCount: 3, color: "var(--paper-mute)" }),
  );
  root.appendChild(sidebar);
  return {
    sidebar,
    destroy: () => {
      root.innerHTML = "";
    },
  };
}
