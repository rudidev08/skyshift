// Stop pointer/wheel events on a DOM surface from leaking into the Phaser
// canvas underneath.

export const DOM_INPUT_SHIELD_EVENT_TYPES = [
  "pointerdown",
  "pointerup",
  "pointermove",
  "pointercancel",
  "wheel",
] as const;

export type BindEventWithDestroyFunction = (
  target: EventTarget,
  type: string,
  listener: EventListener,
) => void;

/** Attach the pointer/wheel `stopPropagation` listeners to `target` and return
 *  a destroy callback that detaches them. Caller pushes the callback onto its
 *  own destroy-callback list. Returns an empty callback when `target` is null. */
export function shieldDomSurfaceFromPhaserInput(target: EventTarget | null): () => void {
  if (!target) return () => {};
  const stopEventPropagation: EventListener = (event) => event.stopPropagation();
  for (const eventType of DOM_INPUT_SHIELD_EVENT_TYPES) {
    target.addEventListener(eventType, stopEventPropagation);
  }
  return () => {
    for (const eventType of DOM_INPUT_SHIELD_EVENT_TYPES) {
      target.removeEventListener(eventType, stopEventPropagation);
    }
  };
}
