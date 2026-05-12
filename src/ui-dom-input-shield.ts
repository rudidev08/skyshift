// Stop pointer/wheel events on a DOM surface from leaking into the Phaser
// canvas underneath.

export const DOM_INPUT_SHIELD_EVENT_TYPES = [
  "pointerdown",
  "pointerup",
  "pointermove",
  "pointercancel",
  "wheel",
] as const;

export type BindEventFunction = (
  target: EventTarget,
  type: string,
  listener: EventListener,
) => void;

/** Caller passes its own `bindEvent` so the shield's listeners share the caller's cleanup lifecycle. */
export function shieldDomSurfaceFromPhaserInput(
  bindEvent: BindEventFunction,
  target: EventTarget | null,
): void {
  if (!target) return;
  const stopEventPropagation: EventListener = (event) => event.stopPropagation();
  for (const eventType of DOM_INPUT_SHIELD_EVENT_TYPES) {
    bindEvent(target, eventType, stopEventPropagation);
  }
}
