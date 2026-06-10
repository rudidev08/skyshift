// URL routing + load-error rendering for the play page. Top-level dispatch
// in game-entry.ts calls into these — startFreshUniverse for /start/:preset,
// resumeSavedUniverse for /universe, and renderLoadError when either path
// fails or the snapshot can't be validated.

import { X } from "lucide-static";
import type { GameMap } from "./sim-map-types";
import { createMapFromTemplate, mapFromSnapshot } from "./sim-map-create";
import { map } from "../data/map";
import { presets } from "../data/map-presets";
import { getPresetById } from "./util-map-preset";
import { readSlot } from "./ui-savegame-manager";
import type { ValidationResult } from "./ui-snapshot-validator";
import { findLatestSave, findCorruptSlot, clearAllSaves } from "./storage-save-slots";
import * as saveError from "../data/strings-save";
import { mountGameRuntime, destroyGameRuntime } from "./game-entry";

const START_ROUTE_PATTERN = /^\/start\/([^/]+)\/?$/;
const UNIVERSE_ROUTE_PATTERN = /^\/universe\/?$/;

export function parseRoute(
  pathname: string,
): { kind: "newGame"; presetId: string } | { kind: "resume" } | null {
  const startMatch = START_ROUTE_PATTERN.exec(pathname);
  if (startMatch) {
    return { kind: "newGame", presetId: decodeURIComponent(startMatch[1]) };
  }
  if (UNIVERSE_ROUTE_PATTERN.test(pathname)) {
    return { kind: "resume" };
  }
  return null;
}

function createMapForPresetId(presetId: string): GameMap {
  const preset = getPresetById(presetId);
  if (!preset) {
    const known = presets.map((preset) => preset.id).join(", ");
    throw new Error(`Unknown preset "${presetId}". Known presets: ${known}.`);
  }
  return createMapFromTemplate(map, preset);
}

export function renderLoadError(message: string, diagnostic?: string) {
  destroyGameRuntime();
  const container = mountLoadErrorPanel();
  populateLoadErrorMessage(container, message);
  if (diagnostic) populateLoadErrorDiagnostic(container, diagnostic);
  const actions = requireElement<HTMLElement>(container, '[data-role="actions"]');
  setupClearSavesConfirmFlow(actions);
}

/** Two-step destructive confirm (idle → pending dots → confirm button) so a
 *  stray click can't wipe every save. Bounces to / on confirm — with no saves
 *  left, landing falls back to first-visit. Mirrors ui-slot-selector.ts. */
function setupClearSavesConfirmFlow(actionsContainer: HTMLElement): void {
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  const resetToIdle = () => {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    renderIdleActions(actionsContainer, () => {
      actionsContainer.innerHTML = `<span class="slot-pending">···</span>`;
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        actionsContainer.innerHTML = "";
        renderConfirmReady(actionsContainer, resetToIdle);
      }, 1500);
    });
  };
  resetToIdle();
}

/** Wipe the canvas + HUD scaffolding and replace with the error panel.
 *  Returns the freshly-inserted container so subsequent lookups can be scoped
 *  to it (a stray matching selector elsewhere on the page can't be picked up). */
function mountLoadErrorPanel(): HTMLElement {
  document.body.innerHTML = `
    <div class="load-error">
      <main class="load-error__panel">
        <p class="load-error__eyebrow">Load error</p>
        <h1 class="load-error__title">Can't load universe</h1>
        <p class="load-error__detail"></p>
        <details class="load-error__diagnostic" hidden>
          <summary>Show details</summary>
          <pre class="load-error__diagnostic-body"></pre>
        </details>
        <div class="load-error__actions" data-role="actions"></div>
      </main>
    </div>
  `;
  return requireElement<HTMLElement>(document.body, ".load-error");
}

function populateLoadErrorMessage(container: HTMLElement, message: string): void {
  // textContent (not innerHTML) — strings may be a thrown Error message or raw
  // save bytes, so don't let them render as markup.
  const detail = requireElement<HTMLElement>(container, ".load-error__detail");
  detail.textContent = message;
}

function populateLoadErrorDiagnostic(container: HTMLElement, diagnostic: string): void {
  const wrapper = requireElement<HTMLElement>(container, ".load-error__diagnostic");
  const body = requireElement<HTMLElement>(container, ".load-error__diagnostic-body");
  wrapper.hidden = false;
  body.textContent = diagnostic;
}

/** Lookup that throws if the selector misses. Use only for elements the
 *  surrounding code just inserted into the template — drift is a bug, and
 *  silent fallback would hide it. */
function requireElement<T extends Element>(parent: ParentNode, selector: string): T {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error(`Required element not found: ${selector}`);
  return element;
}

function renderIdleActions(actions: HTMLElement, onClearClicked: () => void): void {
  actions.innerHTML = "";

  const back = document.createElement("button");
  back.type = "button";
  back.className = "hud-btn";
  back.textContent = "Back to landing";
  back.addEventListener("click", () => window.location.replace("/"));

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "hud-btn hud-btn--danger";
  clear.textContent = "Clear saves";
  clear.addEventListener("click", onClearClicked);

  actions.appendChild(back);
  actions.appendChild(clear);
}

function renderConfirmReady(actions: HTMLElement, onCancel: () => void): void {
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "hud-btn slot-confirm slot-confirm--danger";
  confirm.textContent = "Confirm clear all saves?";
  confirm.addEventListener("click", () => {
    clearAllSaves();
    window.location.replace("/");
  });

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "hud-btn hud-btn-icon";
  cancel.setAttribute("aria-label", "Cancel");
  cancel.innerHTML = X;
  cancel.addEventListener("click", onCancel);

  actions.appendChild(confirm);
  actions.appendChild(cancel);
}

/** Handles `/start/:preset` — fresh universe seeded from the named preset.
 *  The URL is transient; replaceState to `/universe` so a refresh won't reseed. */
export async function startFreshUniverse(presetId: string) {
  const mapData = createMapForPresetId(presetId);
  history.replaceState({}, "", "/universe");
  await mountGameRuntime({ mapData });
}

/** Handles `/universe` — continue the latest save. No save bounces to landing;
 *  a present-but-invalid save shows the load-error panel so the player sees the
 *  reason instead of silently flickering back. */
export async function resumeSavedUniverse() {
  // A corrupt slot (content present, breadcrumbs unreadable) can't be ranked by
  // findLatestSave — without the fallback it would read as "no saves" and bounce
  // silently. Valid saves always win; readSlot then surfaces the corrupt reason.
  const latestSave = findLatestSave() ?? findCorruptSlot();
  // Absent slot reports as `reason: "empty"` to match the readSlot shape, so
  // the one branch below handles "nothing to resume" and "resume blocked".
  const result: ValidationResult = !latestSave
    ? { ok: false, reason: "empty", message: saveError.SLOT_EMPTY }
    : readSlot(latestSave.kind, latestSave.index);
  if (!result.ok) {
    if (result.reason === "empty") {
      // replace (not assign) so Back from the landing doesn't re-enter here.
      window.location.replace("/");
      return;
    }
    renderLoadError(result.message, result.detail);
    return;
  }
  const snapshot = result.snapshot;
  const mapData = mapFromSnapshot(map, snapshot);
  await mountGameRuntime({ mapData, initialSnapshot: snapshot });
}
