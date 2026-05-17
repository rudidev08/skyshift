// Spoken announcements on selection — chains per-word clips with short
// pauses ("[nation]. [name]. [type]."). Off by default; enableAudio()
// triggers lazy fetch/decode of every clip.

import {
  collectVoiceKeysFromMapStations,
  collectCoreVoiceKeys,
  nameToVoiceKey,
  textToVoiceKey,
} from "./audio-voice-keys";
import type { Nation } from "./sim-nation";

let audioEnabled = false;
let announcementsMuted = false;

// Populated on first opt-in. URL strings are bundled at build time, but the
// Map population and all fetch/decode work is deferred until then.
const audioUrlByKey = new Map<string, string>();
const preloadKeys = new Set<string>();
let assetsResolved = false;

let audioContext: AudioContext | null = null;
const audioBufferByKey = new Map<string, AudioBuffer>();
const activeSources: AudioBufferSourceNode[] = [];
let preloadStarted = false;
let currentSequenceId = 0;

function isStillCurrentSequence(capturedSequenceId: number): boolean {
  return audioEnabled && capturedSequenceId === currentSequenceId;
}

function registerPreloadKey(audioKey: string) {
  if (preloadKeys.has(audioKey)) return;
  preloadKeys.add(audioKey);

  // Keys registered after startBackgroundPreload's loop already ran (e.g.
  // lazy-loaded preset names) won't be picked up by it, so kick off their
  // fetch here — otherwise the first selection that needs them stalls
  // waiting on a load that nothing started.
  if (audioEnabled && preloadStarted && audioUrlByKey.has(audioKey)) {
    void loadAudioBufferForKey(audioKey);
  }
}

/** Build the preload key set from bundled WAV URLs. Runs once on first opt-in. */
function registerBundledAudioUrls() {
  if (assetsResolved) return;
  assetsResolved = true;

  // import.meta.glob with eager:true returns string URLs only; no network/decode until loadAudioBufferForKey runs.
  const audioFileUrls = import.meta.glob("./assets/voices/*.wav", {
    eager: true,
    query: "?url",
    import: "default",
  }) as Record<string, string>;

  for (const [path, url] of Object.entries(audioFileUrls)) {
    const key = path.split("/").pop()!.replace(".wav", "");
    audioUrlByKey.set(key, url);
  }

  for (const key of collectCoreVoiceKeys()) {
    registerPreloadKey(key);
  }

  // Lazy preset import keeps presets out of the core bundle. Settled covers
  // the union of names across presets today (Frontier is a subset).
  import("../data/map-preset-settled").then(({ settledPreset }) => {
    for (const key of collectVoiceKeysFromMapStations(settledPreset.presetStations)) {
      registerPreloadKey(key);
    }
  });
}

function ensureAudioContext(): AudioContext {
  if (!audioContext) audioContext = new AudioContext();
  return audioContext;
}

/** Map a display name to clip keys. "Accord II" splits into base + suffix
 *  so both clips play; unsuffixed names return one key. */
function splitNameIntoVoiceKeys(displayName: string): string[] {
  const fullKey = nameToVoiceKey(displayName);
  if (audioUrlByKey.has(fullKey)) return [fullKey];

  const lastSpaceIndex = displayName.lastIndexOf(" ");
  if (lastSpaceIndex > 0) {
    const baseName = displayName.substring(0, lastSpaceIndex);
    const suffix = displayName.substring(lastSpaceIndex + 1);
    const baseKey = nameToVoiceKey(baseName);
    const suffixKey = textToVoiceKey(suffix);
    const keys: string[] = [];
    if (audioUrlByKey.has(baseKey)) keys.push(baseKey);
    if (audioUrlByKey.has(suffixKey)) keys.push(suffixKey);
    if (keys.length > 0) return keys;
  }

  // Bare tokens like "I" / "IV" may be Roman numeral suffixes — try the
  // TTS override path before giving up.
  const suffixKey = textToVoiceKey(displayName);
  if (audioUrlByKey.has(suffixKey)) return [suffixKey];

  return [fullKey];
}

/** Fetch, decode, and cache an AudioBuffer for the given key. */
async function loadAudioBufferForKey(key: string): Promise<AudioBuffer | null> {
  const cached = audioBufferByKey.get(key);
  if (cached) return cached;

  const url = audioUrlByKey.get(key);
  if (!url) return null;

  try {
    const context = ensureAudioContext();
    const response = await fetch(url);
    const data = await response.arrayBuffer();
    const buffer = await context.decodeAudioData(data);
    audioBufferByKey.set(key, buffer);
    return buffer;
  } catch {
    return null;
  }
}

/** Background-load every preload key. Runs once on first selection. */
function startBackgroundPreload() {
  if (preloadStarted) return;
  preloadStarted = true;
  for (const key of preloadKeys) {
    if (audioUrlByKey.has(key)) loadAudioBufferForKey(key);
  }
}

/** Cancel the previous announcement's audio — both clips already playing and
 *  clips a still-loading playSequence is about to start. */
function cancelInFlightSequence() {
  // User clicked a new selection (or toggled audio off) while playSequence
  // was still awaiting buffer loads. The bumped counter makes the in-flight
  // sequence bail before it schedules anything — otherwise stale clips would
  // play on top of the new sequence, since we can't stop sources we haven't
  // created yet.
  currentSequenceId++;
  for (const source of activeSources) {
    try {
      source.stop();
    } catch {
      /* already ended */
    }
  }
  activeSources.length = 0;
}

/** Play phrase groups back-to-back, separated by short pauses for sentence rhythm. */
async function playSequence(phrases: string[][]): Promise<void> {
  cancelInFlightSequence();
  const capturedSequenceId = currentSequenceId;
  startBackgroundPreload();

  const allKeys = phrases.flat();
  await Promise.all(allKeys.map(loadAudioBufferForKey));
  if (!isStillCurrentSequence(capturedSequenceId)) return;

  const context = ensureAudioContext();
  if (context.state === "suspended") await context.resume();
  if (!isStillCurrentSequence(capturedSequenceId)) return;

  // Use the AudioContext clock for sample-accurate timing.
  let when = context.currentTime + 0.05;
  const phraseGap = 0.15;

  for (let phraseIndex = 0; phraseIndex < phrases.length; phraseIndex++) {
    if (!isStillCurrentSequence(capturedSequenceId)) return;
    for (const key of phrases[phraseIndex]) {
      const buffer = audioBufferByKey.get(key);
      if (!buffer) continue;

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start(when);
      activeSources.push(source);

      when += buffer.duration;
    }
    if (phraseIndex < phrases.length - 1) {
      when += phraseGap;
    }
  }
}

/** Opt in. First call resolves asset URLs and starts background preloading. */
export function enableAudio(): void {
  audioEnabled = true;
  registerBundledAudioUrls();
  startBackgroundPreload();
}

/** Opt out. Stops in-flight playback and prevents future late-arriving keys from kicking off fetch/decode. */
export function disableAudio(): void {
  audioEnabled = false;
  preloadStarted = false;
  cancelInFlightSequence();
}

export function isAudioEnabled(): boolean {
  return audioEnabled;
}

export function setAnnouncementsMuted(muted: boolean): void {
  announcementsMuted = muted;
}

/** Announce a station selection: "nation. name. type." */
export function announceStation(name: string, stationTypeName: string, nation: Nation): void {
  if (!audioEnabled || announcementsMuted) return;

  playSequence([
    [nameToVoiceKey(nation.shortName)],
    splitNameIntoVoiceKeys(name),
    [nameToVoiceKey(stationTypeName)],
  ]);
}

/** Announce a ship selection: "nation. name. type." */
export function announceShip(name: string, shipTypeName: string, nation: Nation): void {
  if (!audioEnabled || announcementsMuted) return;

  playSequence([
    [nameToVoiceKey(nation.shortName)],
    splitNameIntoVoiceKeys(name),
    [nameToVoiceKey(shipTypeName)],
  ]);
}

/** Announce a station zone selection: "Unclaimed. [sector name]. [suffix]." */
export function announceStationZone(sectorName: string, suffix: string): void {
  if (!audioEnabled || announcementsMuted) return;

  playSequence([
    [nameToVoiceKey("Unclaimed")],
    splitNameIntoVoiceKeys(sectorName),
    splitNameIntoVoiceKeys(suffix),
  ]);
}
