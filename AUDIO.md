# Audio Pipeline

Generates spoken word clips for in-game station and ship selection announcements.

Uses MLX on macOS. `Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16` auditions voices via `audio-sample-voice.sh`; `Qwen3-TTS-12Hz-1.7B-Base-bf16` clones from the chosen sample to generate all clips.

## Dependencies

- `node` with `npx` available
- `tsx` for running the TypeScript build scripts via `npx tsx`
- Project-root `.venv` is the recommended Python environment for audio work
- `python3` or `python` for `dev/audio/audio-build-generate.py` (`audio-build-all.sh` prefers `.venv/bin/python`, then `python3`, then `python`)
- Python packages used by the generator: `soundfile`, `mlx-audio`, `mlx`
- `ffmpeg` for `dev/audio/audio-build-effect.sh`
- A running TTS endpoint if you use the HTTP-based sample/debug scripts

On macOS, bootstrap everything in one shot from the project root:

```bash
./dev/audio/setup-local-audio-dev.sh
```

The script installs `ffmpeg` via Homebrew, creates `.venv`, and installs the Python packages listed above. It assumes `python3` and Homebrew are already installed and aborts with a helpful message if either is missing.

If you prefer to do it manually:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install soundfile mlx-audio mlx
brew install ffmpeg
```

If your prompt starts with `(.venv)` after activation, that is expected. Leave the environment with:

```bash
deactivate
```

## Pipeline

```text
dev/audio/audio-build-strings.ts    -> dev/audio/data/audio-strings.txt
dev/audio/audio-build-generate.py   -> dev/audio/data/generated/*.wav
dev/audio/audio-build-effect.sh     -> src/assets/voices/*.wav
```

Run the full pipeline:

```bash
./dev/audio/audio-build-all.sh
```

If you are running steps manually, activate the project virtual environment first so the Python dependencies resolve correctly:

```bash
source .venv/bin/activate
```

Or run individual steps:

```bash
npx tsx dev/audio/audio-build-strings.ts   # 1. Extract strings from game data
python3 dev/audio/audio-build-generate.py  # 2. Generate TTS audio (slow, needs GPU)
./dev/audio/audio-build-effect.sh          # 3. Apply radio effect via ffmpeg
```

## Folder Layout

```text
AUDIO.md               This guide
dev/audio/             Scripts and docs
  data/                Audio pipeline inputs and generated files
    audio-strings.txt  Generated string list (committed, always overwritten)
    generated/         Raw TTS output (committed source clips)
    sample.wav         Voice clone reference if you keep one in the repo
    voice-design-samples/ Optional VoiceDesign audition outputs
    clone-test.wav     Optional clone-test output
src/assets/voices/     Game assets rebuilt directly by audio-build-effect.sh
```

## Configuration

Copy `.env.sample` to `.env` at the project root and adjust if needed:

```text
AUDIO_BASE_MODEL         TTS model for voice cloning (full generation)
AUDIO_VOICE_DESIGN_MODEL TTS model for voice design (sample audition)
AUDIO_TTS_API            TTS API endpoint (for HTTP-based scripts)
```

All scripts load `.env` automatically and fall back to defaults if missing.

All file-producing scripts skip outputs that already exist so the pipeline can resume safely, except `dev/audio/audio-build-strings.ts`, which always rewrites `dev/audio/data/audio-strings.txt`, and `dev/audio/audio-build-effect.sh`, which clears `src/assets/voices/` before rebuilding the current processed subset from `dev/audio/data/generated/`.

`dev/audio/audio-build-generate.py` never overwrites existing files in `dev/audio/data/generated/` and never removes extras on its own.

Both `dev/audio/audio-build-generate.py` and `dev/audio/audio-build-effect.sh` now end with a sanity check. They exit non-zero if any expected clip is still missing after the step completes.

## Voice Design

`dev/audio/audio-sample-voice.sh` generates 10 test samples using the VoiceDesign model to audition voices. Pick the best one and copy it to `dev/audio/data/sample.wav`, then run the full pipeline to regenerate all clips with the new voice.

## Test Scripts

- `dev/audio/audio-test-clone.py` - test voice cloning via Python (`mlx-audio`)
- `dev/audio/audio-sample-debug.sh` - single HTTP TTS request with verbose output for API debugging

## File Naming

Filename = lowercase display name, spaces replaced with hyphens, `.wav` extension.

- "Pale Arch" -> `pale-arch.wav`
- "Hub-Cluster Alliance" -> `hub-cluster-alliance.wav`
- Roman numeral suffixes use numbers: "III" -> `3.wav`, "XXIV" -> `24.wav`
