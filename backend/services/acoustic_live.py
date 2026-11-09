"""
backend/services/acoustic_live.py

Live tap classification. The app sends short audio chunks (about 3 s) while the
user taps the coconut. Each chunk:
  1. decoded (reuses services.acoustic.load_audio, so ffmpeg/pydub paths still work)
  2. checked for a real tap (impulsive, loud enough); silence returns tap_detected=False
  3. classified by BOTH existing acoustic models via acoustic.analyze_tap_segment

Reuses the models already loaded in services/acoustic.py (no double load).
Same stage names as /acoustic/audio: malauhog, malakanin.
"""
import asyncio
import os
import tempfile
import time

import numpy as np

from services import acoustic as a

# Tap detection. Tune these if taps are missed or room noise triggers.
TAP_MIN_PEAK = 0.04     # raw peak amplitude (0..1) needed before normalizing
TAP_MIN_CREST = 3.5     # peak / RMS. Taps are impulsive, steady noise is not.

_lock = asyncio.Lock()


def _count_taps(y: np.ndarray, sr: int) -> int:
    """Count separate taps: 20 ms RMS envelope, peaks above 35% of max, 150 ms apart."""
    frame = max(1, int(sr * 0.02))
    n = len(y) // frame
    if n < 3:
        return 0
    env = np.sqrt(np.mean(y[: n * frame].reshape(n, frame) ** 2, axis=1))
    thr = float(env.max()) * 0.35
    min_gap = max(1, int(0.15 / 0.02))
    peaks = []
    for i in range(1, n - 1):
        if env[i] >= thr and env[i] >= env[i - 1] and env[i] > env[i + 1]:
            if not peaks or i - peaks[-1] >= min_gap:
                peaks.append(i)
    return len(peaks)


def _model_block(name: str, r: dict) -> dict:
    return {
        "model_name": name,
        "stage": r.get("stage", "unknown"),
        "confidence": float(r.get("confidence", 0.0)),
        "probabilities": r.get("probabilities", {}),
    }


def _run(audio_bytes: bytes) -> dict:
    t0 = time.perf_counter()

    fmt = a.detect_audio_format(audio_bytes)
    ext = f".{fmt}" if fmt != "unknown" else ".audio"
    tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
    try:
        tmp.write(audio_bytes)
        tmp.close()
        y, sr = a.load_audio(tmp.name, fmt)
    finally:
        try:
            os.remove(tmp.name)
        except Exception:
            pass

    if sr != a.TARGET_SAMPLE_RATE:
        import librosa
        y = librosa.resample(y, orig_sr=sr, target_sr=a.TARGET_SAMPLE_RATE)
        sr = a.TARGET_SAMPLE_RATE

    y = np.asarray(y, dtype=np.float32)
    peak = float(np.max(np.abs(y))) if len(y) else 0.0
    rms = float(np.sqrt(np.mean(y ** 2))) if len(y) else 0.0
    rms_db = float(20 * np.log10(rms + 1e-10))
    crest = peak / (rms + 1e-10)

    base = {
        "peak": round(peak, 4),
        "rms_db": round(rms_db, 1),
        "crest": round(crest, 2),
        "duration": round(len(y) / sr, 2) if sr else 0.0,
    }

    if peak < TAP_MIN_PEAK or crest < TAP_MIN_CREST:
        return {**base, "tap_detected": False, "taps": 0,
                "ms": int((time.perf_counter() - t0) * 1000)}

    # normalize the same way the full-recording endpoint does
    if peak > 1.0:
        y = y / peak

    taps = _count_taps(y, sr)
    out = {**base, "tap_detected": True, "taps": taps}

    if a.acoustic_model is not None:
        clf = a.acoustic_model["classifier"] if isinstance(a.acoustic_model, dict) else a.acoustic_model
        out["internet_sourced_model"] = _model_block(
            "Internet-sourced Model", a.analyze_tap_segment(y, sr, clf))

    if a.acoustic_model2 is not None:
        m2 = a.acoustic_model2
        clf2 = m2["classifier"] if isinstance(m2, dict) else m2
        cfg = m2.get("feature_config") if isinstance(m2, dict) else None
        le = m2.get("label_encoder") if isinstance(m2, dict) else None
        r2 = a.analyze_tap_segment(y, sr, clf2, cfg, label_encoder=le)
        out["own_dataset_augmented_model"] = _model_block("Own Dataset (Augmented)", r2)
        out["metrics"] = {
            "rms_energy_db": r2.get("rms_energy_db", 0.0),
            "dominant_frequency_hz": r2.get("dominant_frequency_hz", 0.0),
        }

    out["ms"] = int((time.perf_counter() - t0) * 1000)
    return out


async def predict_chunk(audio_bytes: bytes) -> dict:
    async with _lock:
        return await asyncio.to_thread(_run, audio_bytes)