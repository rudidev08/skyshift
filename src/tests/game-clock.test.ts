import { test, assertEqual, assertTrue } from "./test-utils.ts";
import { computeGameSecondsThisFrame } from "../game-loop.ts";
import { getOrbitingShipPose, type OrbitState } from "../phaser/ship-orbit-pool.ts";
import type { Ship } from "../sim-ships.ts";

// One render frame at 60fps.
const FRAME_DELTA_SECONDS = 1 / 60;

// A ship parked at a station, with a fixed orbit so the pose depends only on
// the game-clock seconds we feed it.
const orbit: OrbitState = { orbitAngleAtZero: 0.3, orbitSpeedRadiansPerSec: 1.2, orbitRadius: 50 };
const ship = { station: { x: 100, y: 200 } } as unknown as Ship;

test("game clock does not advance while paused — orbiting ships stay frozen", () => {
  let gameClockSeconds = 10;
  const poseBeforePause = getOrbitingShipPose(ship, orbit, gameClockSeconds);

  // Two paused render frames still run (the screen keeps drawing), but the
  // game clock must not move, so the orbit pose must be identical each frame.
  gameClockSeconds += computeGameSecondsThisFrame(FRAME_DELTA_SECONDS, 0, false);
  const poseAfterFirstPausedFrame = getOrbitingShipPose(ship, orbit, gameClockSeconds);
  gameClockSeconds += computeGameSecondsThisFrame(FRAME_DELTA_SECONDS, 0, false);
  const poseAfterSecondPausedFrame = getOrbitingShipPose(ship, orbit, gameClockSeconds);

  assertEqual(poseAfterFirstPausedFrame.angle, poseBeforePause.angle, "orbit angle frozen on paused frame 1");
  assertEqual(poseAfterSecondPausedFrame.angle, poseBeforePause.angle, "orbit angle frozen on paused frame 2");
});

test("game clock advances at the real frame rate while running at 1x", () => {
  const frameGameSeconds = computeGameSecondsThisFrame(FRAME_DELTA_SECONDS, 1, false);
  assertEqual(frameGameSeconds, FRAME_DELTA_SECONDS, "1x advances by the raw frame delta");

  const poseStart = getOrbitingShipPose(ship, orbit, 0);
  const poseAfterFrame = getOrbitingShipPose(ship, orbit, frameGameSeconds);
  assertTrue(poseAfterFrame.angle !== poseStart.angle, "orbit advances when the game is running");
});

test("game clock scales with game speed — 5x advances five times as far as 1x", () => {
  const frameGameSecondsAt1x = computeGameSecondsThisFrame(FRAME_DELTA_SECONDS, 1, false);
  const frameGameSecondsAt5x = computeGameSecondsThisFrame(FRAME_DELTA_SECONDS, 5, false);
  assertEqual(frameGameSecondsAt5x, frameGameSecondsAt1x * 5, "5x covers 5x the game seconds of 1x for the same real frame");
});

test("game clock stays frozen in the static editor even at 1x", () => {
  assertEqual(
    computeGameSecondsThisFrame(FRAME_DELTA_SECONDS, 1, true),
    0,
    "editor is static — no game-clock advance regardless of speed",
  );
});

test("a negative speed is treated as paused, not as reverse time", () => {
  assertEqual(computeGameSecondsThisFrame(FRAME_DELTA_SECONDS, -1, false), 0, "negative speed does not rewind the clock");
});
