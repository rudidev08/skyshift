// Guards the unified input-shield helper (item 101 candidate 1). Both former
// implementations attached `stopPropagation` for every DOM_INPUT_SHIELD_EVENT_TYPES
// event and detached them on teardown; the shared helper must keep that exact
// behavior and the teardown-returning contract.

import { test, assertEqual, assertTrue } from "./test-utils.ts";
import {
  shieldDomSurfaceFromPhaserInput,
  DOM_INPUT_SHIELD_EVENT_TYPES,
} from "../ui-dom-input-shield.ts";

interface Binding {
  type: string;
  listener: EventListener;
}

function buildFakeTarget(): {
  target: EventTarget;
  added: Binding[];
  removed: Binding[];
} {
  const added: Binding[] = [];
  const removed: Binding[] = [];
  const target = {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      added.push({ type, listener: listener as EventListener });
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      removed.push({ type, listener: listener as EventListener });
    },
    dispatchEvent: () => true,
  } as unknown as EventTarget;
  return { target, added, removed };
}

test("shieldDomSurfaceFromPhaserInput attaches a stopPropagation listener for every shielded event type", () => {
  const { target, added } = buildFakeTarget();

  shieldDomSurfaceFromPhaserInput(target);

  assertEqual(
    added.map((binding) => binding.type).sort().join(","),
    [...DOM_INPUT_SHIELD_EVENT_TYPES].sort().join(","),
    "one listener per shielded event type",
  );
  // The listener must call stopPropagation — that's the whole point of the shield.
  let stopped = false;
  const fakeEvent = { stopPropagation: () => (stopped = true) } as unknown as Event;
  added[0].listener(fakeEvent);
  assertTrue(stopped, "shield listener calls event.stopPropagation()");
  // All event types share the one listener instance (matches both old implementations).
  assertTrue(
    added.every((binding) => binding.listener === added[0].listener),
    "every event type binds the same stopPropagation listener",
  );
});

test("the returned teardown detaches exactly the listeners that were attached", () => {
  const { target, added, removed } = buildFakeTarget();

  const teardown = shieldDomSurfaceFromPhaserInput(target);
  teardown();

  assertEqual(removed.length, added.length, "teardown removes every attached listener");
  assertEqual(
    removed.map((binding) => binding.type).sort().join(","),
    [...DOM_INPUT_SHIELD_EVENT_TYPES].sort().join(","),
    "teardown removes one listener per shielded event type",
  );
  for (const removal of removed) {
    assertTrue(
      added.some((addition) => addition.type === removal.type && addition.listener === removal.listener),
      `removed listener for ${removal.type} matches the one that was added`,
    );
  }
});

test("a null target yields a safe teardown that does nothing", () => {
  const teardown = shieldDomSurfaceFromPhaserInput(null);
  assertTrue(typeof teardown === "function", "still returns a callable teardown for a null target");
  teardown(); // must not throw
});
