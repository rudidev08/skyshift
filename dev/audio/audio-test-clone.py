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
output_directory = os.path.join(project_root, "dev/audio/data")
output_file = os.path.join(output_directory, "clone-test.wav")
os.makedirs(output_directory, exist_ok=True)

require_voice_reference(reference_audio)

if os.path.exists(output_file):
    print(f"Skipping clone test (exists): {output_file}")
    raise SystemExit(0)

model_name = os.environ.get("AUDIO_BASE_MODEL", DEFAULT_TTS_MODEL)
model = load_tts_model(model_name)

print("Generating with voice clone...")
results = list(model.generate(
    text="Ironveil station. Large shipyard. Ore Dominion.",
    ref_audio=reference_audio,
    ref_text="Mossgate. Small habitat. Bio-annex. Riftwake. Jumpship. Skyshift Cooperative.",
))

save_generated_audio(output_file, results[0].audio, SAMPLE_RATE_HZ)
print(f"Saved to {output_file}")
