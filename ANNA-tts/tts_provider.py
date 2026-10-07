from __future__ import annotations

import warnings
from typing import Protocol

import numpy as np

warnings.filterwarnings(
    "ignore",
    category=FutureWarning,
    module=r"torch(\.|$)",
)

from kokoro import KPipeline


def apply_comms_effect(audio: np.ndarray) -> np.ndarray:
    if audio.size == 0:
        return audio.astype(np.float32)

    signal = audio.astype(np.float32)
    peak = float(np.max(np.abs(signal)))
    if peak > 0:
        signal = signal / peak

    high_passed = np.empty_like(signal)
    high_passed[0] = signal[0]
    high_passed[1:] = signal[1:] - 0.97 * signal[:-1]

    telephone_band = np.convolve(
        high_passed,
        np.ones(5, dtype=np.float32) / 5,
        mode="same",
    )
    held = np.repeat(telephone_band[::2], 2)[: telephone_band.size]
    crushed = np.round(held * 64) / 64
    distorted = np.tanh(crushed * 1.6)

    noise = np.random.default_rng().normal(0, 0.0001, distorted.size)
    output = distorted + noise.astype(np.float32)
    output_peak = float(np.max(np.abs(output)))
    if output_peak > 0:
        output = output / output_peak * 0.82
    return output.astype(np.float32)


class TTSProvider(Protocol):
    sample_rate: int

    def synthesize(self, text: str, voice: str) -> np.ndarray:
        """Return mono float32 audio for `text` at self.sample_rate."""
        ...


class KokoroProvider:
    """Wraps kokoro.KPipeline behind the TTSProvider interface.

    Swap this out for another engine later without touching
    AudioProcessor or AudioOutput.
    """

    sample_rate = 24000

    def __init__(self, lang_code: str = "a", speed: float = 1.0):
        # Voices must exist under hexgrad/Kokoro-82M's voices/ folder on HF.
        # See VOICES.md in that repo for the current, supported list.
        self.pipeline = KPipeline(lang_code=lang_code, repo_id="hexgrad/Kokoro-82M")
        self.speed = speed

    def synthesize(self, text: str, voice: str) -> np.ndarray:
        chunks = [
            audio.detach().cpu().numpy()
            for _, _, audio in self.pipeline(text, voice=voice, speed=self.speed)
            if audio is not None
        ]
        if not chunks:
            return np.zeros(0, dtype=np.float32)
        return apply_comms_effect(np.concatenate(chunks))
