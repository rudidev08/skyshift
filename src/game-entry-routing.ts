// URL routing + load-error rendering for the play page. Top-level dispatch
// in game-entry.ts calls into these — startFromPreset for /start/:preset,
// continueUniverse for /universe, and renderLoadError when either path fails
// or the snapshot can't be validated.

import { X } from "lucide-static";
import type { GameMap } from "./sim-map-types";
import { createMapFromTemplate, mapFromSnapshot } from "./sim-map-create";
import { map } from "../data/map";
import { presets } from "../data/map-presets";
import { getPresetById } from "./util-map-preset";
import { readSlot, type ValidationResult } from "./ui-savegame-manager";
import { findLatestSave, clearAllSaves } from "./storage-save-slots";
import * as saveError from "../data/strings-save";
import { mountGameRuntime, destroyGameRuntime } from "./game-entry";

const START_ROUTE_PATTERN = /^\/start\/([^/]+)\/?$/;
const UNIVERSE_ROUTE_PATTERN = /^\/universe\/?$/;

export function parseRoute(
  pathname: string,
): { kind: "start"; presetId: string } | { kind: "universe" } | null {
  const normalized = pathname.replace(/\/$/, "") || "/";
  const startMatch = START_ROUTE_PATTERN.exec(normalized);
  if (startMatch) {
    return { kind: "start", presetId: decodeURIComponent(startMatch[1]) };
  }
  if (UNIVERSE_ROUTE_PATTERN.test(normalized)) {
    return { kind: "universe" };
  }
  return null;
}

function createMapForPreset(presetId: string): GameMap {
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
  const renderIdle = () => {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    renderIdleActions(actionsContainer, () => {
      actionsContainer.innerHTML = `<span class="slot-pending">···</span>`;
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        actionsContainer.innerHTML = "";
        renderConfirmReady(actionsContainer, renderIdle);
      }, 1500);
    });
  };
  renderIdle();
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

/** Validate the most recently saved slot, returning the full ValidationResult
 *  so callers can distinguish "nothing to resume" from "resume blocked".
 *  Absent slots report as `reason: "empty"` to match the readSlot shape. */
function validateLatestSave(): ValidationResult {
  const latest = findLatestSave();
  if (!latest || latest.savedAt === null) {
    return { ok: false, reason: "empty", message: saveError.SLOT_EMPTY };
  }
  return readSlot(latest.kind, latest.index);
}

/** Handles `/start/:preset` — fresh universe seeded from the named preset.
 *  The URL is transient; replaceState to `/universe` so a refresh won't reseed. */
export async function startFromPreset(presetId: string) {
  const mapData = createMapForPreset(presetId);
  history.replaceState({}, "", "/universe");
  await mountGameRuntime({ mapData });
}

/** Handles `/universe` — continue the latest save. No save bounces to landing;
 *  a present-but-invalid save shows the load-error panel so the player sees the
 *  reason instead of silently flickering back. */
export async function continueUniverse() {
  const result = validateLatestSave();
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
