from pathlib import Path

import sounddevice as sd

from tts_provider import KokoroProvider


LANG_CODE = "a"
SPEED = 1.2
VOICE = Path(__file__).resolve().parent / "voices" / "anna_voice.pt"


def create_tts() -> KokoroProvider:
	return KokoroProvider(lang_code=LANG_CODE, speed=SPEED)


def speak(text: str) -> None:
	tts = create_tts()
	audio = tts.synthesize(text, voice=str(VOICE))
	sd.play(audio, tts.sample_rate)
	sd.wait()


if __name__ == "__main__":
	speak(
		"Hi Ari. All core systems are operating normally. "
		"Neural services are online and standing by for further instructions."
	)
