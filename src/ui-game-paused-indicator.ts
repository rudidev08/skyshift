import { Pause, Play } from "lucide-static";
import { getSpeedCycleButtonTitle, getSpeedPauseButtonTitle } from "./ui-speed-control-titles";
import { speedCycle, type CycleSpeed } from "../data/controls-game-speed";
import { speedIcons } from "./render-speed-icons";

export interface PausedIndicator {
  /** Speed 0 means paused; non-zero values come from speedCycle or data-dev-speed buttons. */
  setSpeed(speed: number): void;
  destroy(): void;
}

interface PausedIndicatorElements {
  speedHud: HTMLElement;
  pauseButton: HTMLElement;
  pauseButtonIcon: HTMLElement;
  cycleButton: HTMLElement;
  cycleButtonIcon: HTMLElement;
  cycleButtonText: HTMLElement;
}

function queryPausedIndicatorElements(root: ParentNode): PausedIndicatorElements | null {
  const speedHud = root.querySelector<HTMLElement>("#speed-hud");
  const pauseButton = speedHud?.querySelector<HTMLElement>("#speed-pause-btn");
  const pauseButtonIcon = pauseButton?.querySelector<HTMLElement>(".speed-pill__icon");
  const cycleButton = speedHud?.querySelector<HTMLElement>("#speed-cycle-btn");
  const cycleButtonIcon = cycleButton?.querySelector<HTMLElement>(".speed-pill__icon");
  const cycleButtonText = cycleButton?.querySelector<HTMLElement>(".speed-pill__text");
  if (!speedHud || !pauseButton || !pauseButtonIcon || !cycleButton || !cycleButtonIcon || !cycleButtonText) {
    return null;
  }
  return { speedHud, pauseButton, pauseButtonIcon, cycleButton, cycleButtonIcon, cycleButtonText };
}

export function createPausedIndicator(root: ParentNode): PausedIndicator {
  const elements = queryPausedIndicatorElements(root);
  // Scene startup is shared with pages that lack the speed controls — treat
  // the indicator as optional instead of crashing there.
  if (!elements) return { setSpeed() {}, destroy() {} };

  const { speedHud, pauseButton, pauseButtonIcon, cycleButton, cycleButtonIcon, cycleButtonText } = elements;
  const devSpeedTargets: Array<{ button: HTMLButtonElement; speed: number }> = [];
  for (const button of speedHud.querySelectorAll<HTMLButtonElement>("[data-dev-speed]")) {
    const speed = Number.parseFloat(button.dataset.devSpeed ?? "");
    if (Number.isFinite(speed) && speed > 0) devSpeedTargets.push({ button, speed });
  }

  // Always the pause glyph — .is-on signals active state. Switching glyphs
  // would imply the icon is the action to perform; here it identifies the button.
  pauseButtonIcon.innerHTML = Pause;

  // The cycle button always shows a speed label/icon — even paused — so users
  // know what they'll resume to. Only cycle-list speeds update this; devmode
  // speeds (20×, 60×) light their own pill instead.
  let lastCycleSpeed = 1;

  function setSpeed(speed: number) {
    speedHud.toggleAttribute("hidden", false);
    const paused = speed === 0;
    const onCycleSpeed = !paused && (speedCycle as ReadonlyArray<number>).includes(speed);
    const keyboardShortcutsEnabled = speedHud.dataset.keyboardShortcutsEnabled === "true";

    updatePauseButton(paused, keyboardShortcutsEnabled);
    if (onCycleSpeed) lastCycleSpeed = speed;
    updateCycleButton(onCycleSpeed, lastCycleSpeed, keyboardShortcutsEnabled);
    updateDevSpeedPills(speed);
  }

  function updatePauseButton(paused: boolean, keyboardShortcutsEnabled: boolean): void {
    pauseButton.classList.toggle("is-on", paused);
    pauseButton.title = getSpeedPauseButtonTitle(paused, keyboardShortcutsEnabled);
  }

  function updateCycleButton(
    onCycleSpeed: boolean,
    cycleSpeed: number,
    keyboardShortcutsEnabled: boolean,
  ): void {
    cycleButton.title = getSpeedCycleButtonTitle(keyboardShortcutsEnabled);
    cycleButtonIcon.innerHTML = speedIcons[cycleSpeed as CycleSpeed] ?? Play;
    cycleButtonText.textContent = `${cycleSpeed}×`;
    cycleButton.classList.toggle("is-on", onCycleSpeed);
  }

  function updateDevSpeedPills(currentSpeed: number): void {
    for (const { button, speed: target } of devSpeedTargets) {
      button.classList.toggle("is-on", currentSpeed === target);
    }
  }

  return {
    setSpeed,
    destroy() {
      speedHud.toggleAttribute("hidden", true);
    },
  };
}
