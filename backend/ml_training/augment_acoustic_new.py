"""
Acoustic Dataset Preprocessor & Augmentor  →  acoustic_new
===========================================================
Reads raw WAV files from:
  acousticraw/malakanin/*.wav
  acousticraw/malauhog/*.wav

Preprocesses, augments, and distributes them into:
  acoustic_new/train/{class}/*.wav
  acoustic_new/valid/{class}/*.wav
  acoustic_new/test/{class}/*.wav

Preprocessing per file
-----------------------
  • Resample to SAMPLE_RATE (22 050 Hz)
  • Trim leading/trailing silence  (top_db = 30)
  • Normalise amplitude to [-1, 1]
  • Pad / centre-crop to CLIP_DURATION (5 s)

Augmentation  (training split only)
-------------------------------------
  noise_light  – light Gaussian noise  (σ = 0.005)
  noise_heavy  – heavy Gaussian noise  (σ = 0.020)
  ts_slow      – time-stretch ×0.85
  ts_fast      – time-stretch ×1.15
  ps_up        – pitch-shift +2 semitones
  ps_down      – pitch-shift −2 semitones
  shift_fwd    – cyclic time-shift +10 %
  vol_up       – amplitude × 1.20
  vol_down     – amplitude × 0.75

  AUG_PER_SAMPLE (default = 6) are randomly selected per training file.

Requirements
------------
  pip install librosa soundfile numpy scipy
"""

import os
import shutil
import random
from pathlib import Path

import numpy as np
import librosa
import soundfile as sf

# ─────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────
BASE_DIR        = Path(__file__).parent
RAW_DIR         = BASE_DIR / "acousticraw"
OUT_DIR         = BASE_DIR / "acoustic_new"

CLASSES         = ["malakanin", "malauhog"]

SAMPLE_RATE     = 22050          # Hz
CLIP_DURATION   = 5.0            # seconds
SILENCE_TOP_DB  = 30             # dB

# Split ratios (must sum to 1.0)
TRAIN_RATIO     = 0.70
VALID_RATIO     = 0.15
TEST_RATIO      = 0.15

# Augmented copies per training file (max 9 available)
AUG_PER_SAMPLE  = 6

SEED            = 42
random.seed(SEED)
np.random.seed(SEED)


# ─────────────────────────────────────────────────────────────────
# Preprocessing
# ─────────────────────────────────────────────────────────────────

def load_and_preprocess(filepath: Path,
                        sr: int   = SAMPLE_RATE,
                        duration: float = CLIP_DURATION,
                        top_db: int     = SILENCE_TOP_DB) -> np.ndarray:
    """
    Load a WAV file and return a fixed-length, normalised float32 array.

    Steps
    -----
    1. Resample to `sr` Hz (mono)
    2. Trim leading/trailing silence
    3. Normalise amplitude to [-1, 1]
    4. Centre-crop or reflect-pad to `duration` seconds
    """
    y, _ = librosa.load(str(filepath), sr=sr, mono=True)

    # Trim silence
    y, _ = librosa.effects.trim(y, top_db=top_db)

    # Normalise
    max_val = np.max(np.abs(y))
    if max_val > 0:
        y = y / max_val

    target_len = int(sr * duration)

    if len(y) >= target_len:
        # Centre-crop
        start = (len(y) - target_len) // 2
        y = y[start: start + target_len]
    else:
        # Reflect-pad
        pad_len = target_len - len(y)
        y = np.pad(y, (0, pad_len), mode="reflect")

    return y.astype(np.float32)


# ─────────────────────────────────────────────────────────────────
# Augmentation
# ─────────────────────────────────────────────────────────────────

def _fix_length(y: np.ndarray, target_len: int) -> np.ndarray:
    """Crop or reflect-pad to exactly target_len samples."""
    if len(y) >= target_len:
        return y[:target_len].astype(np.float32)
    return np.pad(y, (0, target_len - len(y)), mode="reflect").astype(np.float32)


def augment(y: np.ndarray, sr: int = SAMPLE_RATE) -> dict:
    """
    Generate up to 9 augmented variants of a clip.
    Returns a dict of {tag: float32_array}.
    AUG_PER_SAMPLE are randomly chosen from all available variants.
    """
    augs: dict = {}
    target_len = len(y)

    # 1. Light Gaussian noise
    augs["noise_light"] = np.clip(
        y + 0.005 * np.random.randn(target_len).astype(np.float32),
        -1.0, 1.0).astype(np.float32)

    # 2. Heavy Gaussian noise
    augs["noise_heavy"] = np.clip(
        y + 0.020 * np.random.randn(target_len).astype(np.float32),
        -1.0, 1.0).astype(np.float32)

    # 3. Time-stretch slow (0.85×)
    try:
        augs["ts_slow"] = _fix_length(
            librosa.effects.time_stretch(y, rate=0.85), target_len)
    except Exception:
        pass

    # 4. Time-stretch fast (1.15×)
    try:
        augs["ts_fast"] = _fix_length(
            librosa.effects.time_stretch(y, rate=1.15), target_len)
    except Exception:
        pass

    # 5. Pitch shift up (+2 semitones)
    try:
        augs["ps_up"] = librosa.effects.pitch_shift(y, sr=sr, n_steps=2).astype(np.float32)
    except Exception:
        pass

    # 6. Pitch shift down (−2 semitones)
    try:
        augs["ps_down"] = librosa.effects.pitch_shift(y, sr=sr, n_steps=-2).astype(np.float32)
    except Exception:
        pass

    # 7. Cyclic time-shift forward 10 %
    augs["shift_fwd"] = np.roll(y, int(0.10 * target_len)).astype(np.float32)

    # 8. Volume up (×1.20)
    augs["vol_up"] = np.clip(y * 1.20, -1.0, 1.0).astype(np.float32)

    # 9. Volume down (×0.75)
    augs["vol_down"] = (y * 0.75).astype(np.float32)

    # Randomly select AUG_PER_SAMPLE augmentations for variety
    keys = list(augs.keys())
    random.shuffle(keys)
    selected = keys[:AUG_PER_SAMPLE]
    return {k: augs[k] for k in selected}


# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────

def save_wav(y: np.ndarray, path: Path, sr: int = SAMPLE_RATE):
    """Write float32 audio array as a 16-bit PCM WAV file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), y, sr, subtype="PCM_16")


def clear_output_dirs():
    """Wipe existing acoustic_new/train, valid, test before regeneration."""
    for split in ("train", "valid", "test"):
        for cls in CLASSES:
            p = OUT_DIR / split / cls
            if p.exists():
                shutil.rmtree(p)
                print(f"  Cleared  {p.relative_to(BASE_DIR)}")


# ─────────────────────────────────────────────────────────────────
# Per-class processing
# ─────────────────────────────────────────────────────────────────

def process_class(cls: str) -> dict:
    """
    Process all raw WAV files for one class.
    Returns counts dict: {'train': int, 'valid': int, 'test': int}.
    """
    raw_class_dir = RAW_DIR / cls
    wav_files = sorted(raw_class_dir.glob("*.wav")) + \
                sorted(raw_class_dir.glob("*.WAV"))

    if not wav_files:
        print(f"  WARNING: No WAV files found in {raw_class_dir}")
        return {"train": 0, "valid": 0, "test": 0}

    print(f"\n{'─' * 58}")
    print(f"  Class : {cls.upper()}  ({len(wav_files)} raw files)")
    print(f"{'─' * 58}")

    # Shuffle then split at the raw-file level (no data leakage)
    random.shuffle(wav_files)
    n        = len(wav_files)
    n_test   = max(1, round(n * TEST_RATIO))
    n_valid  = max(1, round(n * VALID_RATIO))
    n_train  = n - n_test - n_valid

    test_files  = wav_files[:n_test]
    valid_files = wav_files[n_test: n_test + n_valid]
    train_files = wav_files[n_test + n_valid:]

    print(f"  Split  →  train: {len(train_files)}  |  "
          f"valid: {len(valid_files)}  |  test: {len(test_files)}")

    counts = {"train": 0, "valid": 0, "test": 0}

    # ── TEST  — originals only, no augmentation ───────────────────
    print("  Processing TEST  …", end=" ", flush=True)
    for fp in test_files:
        try:
            y = load_and_preprocess(fp)
            save_wav(y, OUT_DIR / "test" / cls / f"{fp.stem}_orig.wav")
            counts["test"] += 1
        except Exception as e:
            print(f"\n  ERROR on {fp.name}: {e}")
    print(f"done ({counts['test']} files)")

    # ── VALID — originals only, no augmentation ───────────────────
    print("  Processing VALID …", end=" ", flush=True)
    for fp in valid_files:
        try:
            y = load_and_preprocess(fp)
            save_wav(y, OUT_DIR / "valid" / cls / f"{fp.stem}_orig.wav")
            counts["valid"] += 1
        except Exception as e:
            print(f"\n  ERROR on {fp.name}: {e}")
    print(f"done ({counts['valid']} files)")

    # ── TRAIN — original + AUG_PER_SAMPLE augmented variants ──────
    print("  Processing TRAIN …", end=" ", flush=True)
    for fp in train_files:
        try:
            y = load_and_preprocess(fp)

            # Original
            save_wav(y, OUT_DIR / "train" / cls / f"{fp.stem}_orig.wav")
            counts["train"] += 1

            # Augmented copies
            for tag, y_aug in augment(y).items():
                save_wav(y_aug, OUT_DIR / "train" / cls / f"{fp.stem}_{tag}.wav")
                counts["train"] += 1
        except Exception as e:
            print(f"\n  ERROR on {fp.name}: {e}")
    print(f"done ({counts['train']} files)")

    total = sum(counts.values())
    print(f"\n  Saved  →  train: {counts['train']}  |  "
          f"valid: {counts['valid']}  |  test: {counts['test']}  "
          f"(total: {total})")
    return counts


# ─────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────

def main():
    print("\n" + "=" * 58)
    print("  Acoustic Dataset Preprocessor & Augmentor")
    print("  Raw  →  acoustic_new")
    print("=" * 58)
    print(f"\n  Source  : {RAW_DIR}")
    print(f"  Output  : {OUT_DIR}")
    print(f"  SR      : {SAMPLE_RATE} Hz  |  Clip: {CLIP_DURATION} s")
    print(f"  Split   : train {TRAIN_RATIO:.0%} / "
          f"valid {VALID_RATIO:.0%} / test {TEST_RATIO:.0%}")
    print(f"  Aug/file (train only): {AUG_PER_SAMPLE}")

    print("\n  Clearing existing output directories …")
    clear_output_dirs()

    grand = {"train": 0, "valid": 0, "test": 0}
    for cls in CLASSES:
        result = process_class(cls)
        for k in grand:
            grand[k] += result[k]

    print("\n" + "=" * 58)
    print("  FINISHED")
    print(f"  Grand total  →  train: {grand['train']}  |  "
          f"valid: {grand['valid']}  |  test: {grand['test']}")
    grand_all = sum(grand.values())
    print(f"  All files written : {grand_all}")
    print(f"  Output directory  : {OUT_DIR}")
    print("=" * 58 + "\n")


if __name__ == "__main__":
    main()
