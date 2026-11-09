"""
Acoustic Dataset Preprocessor & Augmentor
==========================================
Reads raw WAV files from acousticraw/{class}/
Preprocesses, augments, and distributes them into:
  acoustic/train/{class}/
  acoustic/valid/{class}/
  acoustic/test/{class}/

Classes: malakanin, malauhog

Requirements:
    pip install librosa soundfile numpy scipy
"""

import os
import shutil
import random
import numpy as np
import librosa
import soundfile as sf
from pathlib import Path

# ─────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────
BASE_DIR       = Path(__file__).parent
RAW_DIR        = BASE_DIR / "acousticraw"
OUT_DIR        = BASE_DIR / "acoustic"

CLASSES        = ["malakanin", "malauhog"]
SAMPLE_RATE    = 22050          # Target sample rate (Hz)
CLIP_DURATION  = 5.0            # Fixed clip length in seconds
SILENCE_TOP_DB = 30             # dB threshold for silence trim

# Train / Valid / Test split (must sum to 1.0)
TRAIN_RATIO    = 0.70
VALID_RATIO    = 0.15
TEST_RATIO     = 0.15

# How many augmented copies to generate per TRAINING file
AUG_PER_SAMPLE = 6

SEED           = 42
random.seed(SEED)
np.random.seed(SEED)


# ─────────────────────────────────────────────
# Preprocessing helpers
# ─────────────────────────────────────────────

def load_and_preprocess(filepath: Path, sr: int = SAMPLE_RATE,
                        duration: float = CLIP_DURATION,
                        top_db: int = SILENCE_TOP_DB) -> np.ndarray:
    """Load a WAV file, resample, trim silence, normalize, and pad/crop."""
    y, _ = librosa.load(str(filepath), sr=sr, mono=True)

    # Trim leading/trailing silence
    y, _ = librosa.effects.trim(y, top_db=top_db)

    # Normalize amplitude to [-1, 1]
    max_val = np.max(np.abs(y))
    if max_val > 0:
        y = y / max_val

    target_len = int(sr * duration)

    if len(y) >= target_len:
        # Crop from the centre to keep the most informative part
        start = (len(y) - target_len) // 2
        y = y[start: start + target_len]
    else:
        # Pad with zeros (reflection padding feels more natural for audio)
        pad_len = target_len - len(y)
        y = np.pad(y, (0, pad_len), mode="reflect")

    return y.astype(np.float32)


# ─────────────────────────────────────────────
# Augmentation helpers
# ─────────────────────────────────────────────

def augment(y: np.ndarray, sr: int = SAMPLE_RATE) -> dict[str, np.ndarray]:
    """Return a dict of {tag: augmented_audio} from a single clip."""

    augmentations: dict[str, np.ndarray] = {}

    # 1. Add Gaussian white noise (light)
    noise_light = y + 0.005 * np.random.randn(len(y))
    augmentations["noise_light"] = np.clip(noise_light, -1.0, 1.0).astype(np.float32)

    # 2. Add Gaussian white noise (heavy)
    noise_heavy = y + 0.02 * np.random.randn(len(y))
    augmentations["noise_heavy"] = np.clip(noise_heavy, -1.0, 1.0).astype(np.float32)

    # 3. Time stretch – slow (0.85x)
    try:
        ts_slow = librosa.effects.time_stretch(y, rate=0.85)
        ts_slow = _fix_length(ts_slow, len(y))
        augmentations["ts_slow"] = ts_slow
    except Exception:
        pass

    # 4. Time stretch – fast (1.15x)
    try:
        ts_fast = librosa.effects.time_stretch(y, rate=1.15)
        ts_fast = _fix_length(ts_fast, len(y))
        augmentations["ts_fast"] = ts_fast
    except Exception:
        pass

    # 5. Pitch shift up (+2 semitones)
    try:
        ps_up = librosa.effects.pitch_shift(y, sr=sr, n_steps=2)
        augmentations["ps_up"] = ps_up
    except Exception:
        pass

    # 6. Pitch shift down (−2 semitones)
    try:
        ps_down = librosa.effects.pitch_shift(y, sr=sr, n_steps=-2)
        augmentations["ps_down"] = ps_down
    except Exception:
        pass

    # 7. Time shift (roll forward ~10 %)
    shift_samples = int(0.10 * len(y))
    augmentations["shift_fwd"] = np.roll(y, shift_samples).astype(np.float32)

    # 8. Volume scale up
    augmentations["vol_up"] = np.clip(y * 1.20, -1.0, 1.0).astype(np.float32)

    # 9. Volume scale down
    augmentations["vol_down"] = (y * 0.75).astype(np.float32)

    # Only return AUG_PER_SAMPLE items (randomly chosen for variety)
    keys = list(augmentations.keys())
    random.shuffle(keys)
    selected = keys[:AUG_PER_SAMPLE]
    return {k: augmentations[k] for k in selected}


def _fix_length(y: np.ndarray, target_len: int) -> np.ndarray:
    """Crop or pad an array to exactly target_len samples."""
    if len(y) >= target_len:
        return y[:target_len].astype(np.float32)
    return np.pad(y, (0, target_len - len(y)), mode="reflect").astype(np.float32)


# ─────────────────────────────────────────────
# Distribution
# ─────────────────────────────────────────────

def clear_output_dirs():
    """Optional: wipe existing acoustic/train, valid, test before regeneration."""
    for split in ("train", "valid", "test"):
        for cls in CLASSES:
            p = OUT_DIR / split / cls
            if p.exists():
                shutil.rmtree(p)
                print(f"  🗑  Cleared {p.relative_to(BASE_DIR)}")


def save_wav(y: np.ndarray, path: Path, sr: int = SAMPLE_RATE):
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), y, sr, subtype="PCM_16")


def process_class(cls: str):
    raw_class_dir = RAW_DIR / cls
    wav_files = sorted(raw_class_dir.glob("*.wav")) + sorted(raw_class_dir.glob("*.WAV"))

    if not wav_files:
        print(f"  ⚠  No WAV files found in {raw_class_dir}")
        return

    print(f"\n{'─'*55}")
    print(f"  Class : {cls.upper()}  ({len(wav_files)} raw files)")
    print(f"{'─'*55}")

    # Shuffle and split ORIGINAL files first (no data leakage)
    random.shuffle(wav_files)
    n = len(wav_files)
    n_test  = max(1, round(n * TEST_RATIO))
    n_valid = max(1, round(n * VALID_RATIO))
    n_train = n - n_test - n_valid

    test_files  = wav_files[:n_test]
    valid_files = wav_files[n_test: n_test + n_valid]
    train_files = wav_files[n_test + n_valid:]

    print(f"  Split → train: {len(train_files)}  valid: {len(valid_files)}  test: {len(test_files)}")

    counts = {"train": 0, "valid": 0, "test": 0}

    # ── TEST  (originals only, NO augmentation) ──────────────────────────────
    for fp in test_files:
        y = load_and_preprocess(fp)
        out_path = OUT_DIR / "test" / cls / f"{fp.stem}_orig.wav"
        save_wav(y, out_path)
        counts["test"] += 1

    # ── VALID (originals only, NO augmentation) ──────────────────────────────
    for fp in valid_files:
        y = load_and_preprocess(fp)
        out_path = OUT_DIR / "valid" / cls / f"{fp.stem}_orig.wav"
        save_wav(y, out_path)
        counts["valid"] += 1

    # ── TRAIN (original + augmented copies) ──────────────────────────────────
    for fp in train_files:
        y = load_and_preprocess(fp)

        # Save original
        out_path = OUT_DIR / "train" / cls / f"{fp.stem}_orig.wav"
        save_wav(y, out_path)
        counts["train"] += 1

        # Save augmented copies
        aug_dict = augment(y)
        for tag, y_aug in aug_dict.items():
            out_path = OUT_DIR / "train" / cls / f"{fp.stem}_{tag}.wav"
            save_wav(y_aug, out_path)
            counts["train"] += 1

    print(f"  ✅ Saved → train: {counts['train']}  valid: {counts['valid']}  test: {counts['test']}")
    total = sum(counts.values())
    print(f"  📦 Total files written for [{cls}]: {total}")
    return counts


# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────

def main():
    print("\n" + "="*55)
    print("  Acoustic Dataset Preprocessor & Augmentor")
    print("="*55)
    print(f"\n  Source : {RAW_DIR}")
    print(f"  Output : {OUT_DIR}")
    print(f"  SR     : {SAMPLE_RATE} Hz  |  Clip: {CLIP_DURATION}s")
    print(f"  Split  : train {TRAIN_RATIO:.0%} / valid {VALID_RATIO:.0%} / test {TEST_RATIO:.0%}")
    print(f"  Aug/sample (train only): {AUG_PER_SAMPLE}")

    print("\n  Clearing existing output directories …")
    clear_output_dirs()

    grand_total = {"train": 0, "valid": 0, "test": 0}
    for cls in CLASSES:
        result = process_class(cls)
        if result:
            for k in grand_total:
                grand_total[k] += result[k]

    print("\n" + "="*55)
    print("  DONE")
    print(f"  Grand total → train: {grand_total['train']}  "
          f"valid: {grand_total['valid']}  test: {grand_total['test']}")
    print(f"  All classes : {CLASSES}")
    print("="*55 + "\n")


if __name__ == "__main__":
    main()
