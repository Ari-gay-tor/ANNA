import sys

import sounddevice as sd

from test import LANG_CODE, SPEED, VOICE
from tts_provider import KokoroProvider


tts = KokoroProvider(lang_code=LANG_CODE, speed=SPEED)

for text in sys.stdin:
    text = text.strip()
    if not text:
        continue

    audio = tts.synthesize(text, voice=str(VOICE))
    sd.play(audio, tts.sample_rate)
    sd.wait()