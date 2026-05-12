// Auto-pauses the sim while overview view or settings panel is open, then resumes — but only if the user hadn't manually paused first.
import { isSimPaused, pauseSim, resumeSim } from "./time-controls";

/** Pauses the sim if running; returns a release that's safe to call more than once. If already paused, release does nothing so a manual user pause survives the scope. */
export function acquireScopedPause(): () => void {
  if (isSimPaused()) {
    // Empty release lets callers always call it unconditionally — we didn't pause, so we don't resume.
    return () => {};
  }
  pauseSim();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    resumeSim();
  };
}
