// Lucide SVG per cycle speed, shown in the cycle pill.

import { Play, FastForward, SkipForward } from "lucide-static";
import type { CycleSpeed } from "../data/controls-game-speed";

export const SPEED_ICONS: Record<CycleSpeed, string> = {
  1: Play,
  2: FastForward,
  5: SkipForward,
};
