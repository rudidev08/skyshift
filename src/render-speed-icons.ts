// Lucide SVG per cycle speed, shown in the cycle pill.

import { Play, FastForward, SkipForward } from "lucide-static";
import type { CycleSpeed } from "../data/controls-game-speed";

export const speedIcons: Record<CycleSpeed, string> = {
  1: Play,
  2: FastForward,
  5: SkipForward,
};
