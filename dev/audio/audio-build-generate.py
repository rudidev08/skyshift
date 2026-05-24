import os
from audio_common import (
    DEFAULT_TTS_MODEL,
    SAMPLE_RATE_HZ,
    install_python_cache_cleanup,
    load_env_from_project_root,
    load_tts_model,
    project_root,
    require_voice_reference,
    save_generated_audio,
)

install_python_cache_cleanup()
load_env_from_project_root()

reference_audio = os.path.join(project_root, "dev/audio/data/sample.wav")
strings_file = os.path.join(project_root, "dev/audio/data/audio-strings.txt")
output_directory = os.path.join(project_root, "dev/audio/data/generated")

os.makedirs(output_directory, exist_ok=True)

require_voice_reference(reference_audio)

if not os.path.exists(strings_file):
    raise SystemExit(f"Missing generated string list: {strings_file}")


def text_to_filename(text):
    return text.lower().replace(" ", "-") + ".wav"


def collect_missing_filenames(output_directory, expected_filenames):
    return [
        filename for filename in expected_filenames
        if not os.path.exists(os.path.join(output_directory, filename))
    ]

# Read all strings
with open(strings_file) as file:
    raw = file.read().strip()
strings = [s.strip() for s in raw.split(",") if s.strip()]
expected_filenames = [text_to_filename(text) for text in strings]
expected_filename_set = set(expected_filenames)

existing_filenames = sorted(
    name for name in os.listdir(output_directory)
    if name.endswith(".wav")
)
stale_filenames = [name for name in existing_filenames if name not in expected_filename_set]
current_file_count = len(existing_filenames) - len(stale_filenames)

print(f"Unprocessed clips in {output_directory}/: {current_file_count} current, {len(stale_filenames)} extra.")
if stale_filenames:
    print("  Extra files not in current audio-strings.txt:")
    for filename in stale_filenames:
        print(f"    {filename}")
    # WHAT: offer deletion interactively so stale clips from renamed or removed
    # strings don't quietly persist and end up copied into the game's voice assets.
    try:
        answer = input(f"  Delete {len(stale_filenames)} extra file(s)? [y/N] ").strip().lower()
    except EOFError:
        answer = ""
    if answer == "y":
        for filename in stale_filenames:
            os.remove(os.path.join(output_directory, filename))
        print(f"  Deleted {len(stale_filenames)} extra file(s).")
    else:
        print("  Keeping extra files in place.")

reference_text = "Mossgate. Small habitat. Bio-annex. Riftwake. Jumpship. Skyshift Cooperative."

model_name = os.environ.get("AUDIO_BASE_MODEL", DEFAULT_TTS_MODEL)
model = load_tts_model(model_name)

print(f"Generating {len(strings)} audio files...")
for index, text in enumerate(strings):
    # Filename: lowercase, spaces to hyphens
    filename = expected_filenames[index]
    output_path = os.path.join(output_directory, filename)

    if os.path.exists(output_path):
        print(f"  [{index + 1}/{len(strings)}] {text} (exists, skipping)")
        continue

    print(f"  [{index + 1}/{len(strings)}] {text}")
    results = list(model.generate(
        text=text,
        ref_audio=reference_audio,
        ref_text=reference_text,
    ))

    save_generated_audio(output_path, results[0].audio, SAMPLE_RATE_HZ)

missing_filenames = collect_missing_filenames(output_directory, expected_filenames)
if missing_filenames:
    print(f"ERROR: {len(missing_filenames)} generated clips are still missing from {output_directory}/")
    for filename in missing_filenames[:20]:
        print(f"  MISSING: {filename}")
    if len(missing_filenames) > 20:
        print(f"  ... and {len(missing_filenames) - 20} more")
    raise SystemExit(1)

print(f"Done. Verified {len(expected_filenames)} generated clips in {output_directory}/")
