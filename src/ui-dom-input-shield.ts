// Stop pointer/wheel events on a DOM surface from leaking into the Phaser
// canvas underneath.

export const DOM_INPUT_SHIELD_EVENT_TYPES = [
  "pointerdown",
  "pointerup",
  "pointermove",
  "pointercancel",
  "wheel",
] as const;

export type BindEventWithCleanupFunction = (
  target: EventTarget,
  type: string,
  listener: EventListener,
) => void;

/** Caller passes its own `bindEventWithCleanup` so the shield's listeners share the caller's cleanup lifecycle. */
export function shieldDomSurfaceFromPhaserInput(
  bindEventWithCleanup: BindEventWithCleanupFunction,
  target: EventTarget | null,
): void {
  if (!target) return;
  const stopEventPropagation: EventListener = (event) => event.stopPropagation();
  for (const eventType of DOM_INPUT_SHIELD_EVENT_TYPES) {
    bindEventWithCleanup(target, eventType, stopEventPropagation);
  }
}
