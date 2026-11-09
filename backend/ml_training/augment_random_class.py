"""
augment_random_class.py
-----------------------
Augments 179 source images from the 'randomthings' folder and distributes
them into own_dataset/train/random, own_dataset/valid/random, and
own_dataset/test/random with the following target counts:

  TRAIN  → 1200
  VALID  →   70
  TEST   →   28

Strategy:
  1. Load all source images and shuffle deterministically.
  2. Split source images first (no data leakage between splits):
       ~80% → train pool   (~143 images)
       ~11% → valid pool   (~ 20 images)
       ~9%  → test pool    (~ 16 images)
  3. For each split, repeatedly apply random augmentations until
     the target count is reached.

Augmentation techniques used:
  - Resize to 224×224 (MobileNetV2 standard)
  - Rotation (90 / 180 / 270°)
  - Horizontal flip
  - Vertical flip
  - Brightness adjustment (±30%)
  - Contrast adjustment (±30%)
  - Sharpness adjustment
  - Random crop + resize (zoom effect)
  - Combined augmentations
"""

import os
import random
import shutil
from PIL import Image, ImageEnhance, ImageOps

# ── Configuration ────────────────────────────────────────────────────────────

SOURCE_DIR   = r"S:\REPOSITORIES\cocovision\backend\ml_training\randomthings"
DEST_DIR     = r"S:\REPOSITORIES\cocovision\backend\ml_training\own_dataset"
TARGET_SIZE  = (224, 224)
RANDOM_SEED  = 42

TARGETS = {
    'train': 1200,
    'valid': 70,
    'test':  28,
}

# Approximate source split ratios (must sum to 1.0)
SPLIT_RATIOS = {
    'train': 0.80,
    'valid': 0.11,
    'test':  0.09,
}

IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.bmp', '.webp'}

# ── Augmentation helpers ─────────────────────────────────────────────────────

def load_and_resize(path: str) -> Image.Image:
    return Image.open(path).convert('RGB').resize(TARGET_SIZE)


def augment(img: Image.Image, aug_id: int) -> Image.Image:
    """
    Deterministically applies an augmentation based on aug_id.
    aug_id cycles through a fixed set of transforms so every call
    with the same id produces the same result.
    """
    ops = aug_id % 18  # 18 distinct augmentation slots

    if ops == 0:
        return img                                                     # original
    elif ops == 1:
        return img.rotate(90)
    elif ops == 2:
        return img.rotate(180)
    elif ops == 3:
        return img.rotate(270)
    elif ops == 4:
        return img.transpose(Image.FLIP_LEFT_RIGHT)
    elif ops == 5:
        return img.transpose(Image.FLIP_TOP_BOTTOM)
    elif ops == 6:
        return ImageEnhance.Brightness(img).enhance(1.3)
    elif ops == 7:
        return ImageEnhance.Brightness(img).enhance(0.7)
    elif ops == 8:
        return ImageEnhance.Contrast(img).enhance(1.3)
    elif ops == 9:
        return ImageEnhance.Contrast(img).enhance(0.7)
    elif ops == 10:
        return ImageEnhance.Sharpness(img).enhance(2.0)
    elif ops == 11:
        return ImageEnhance.Sharpness(img).enhance(0.3)
    elif ops == 12:
        # Random crop → resize (zoom-in effect)
        rng = random.Random(aug_id)
        crop_frac = rng.uniform(0.75, 0.92)
        w, h = img.size
        new_w, new_h = int(w * crop_frac), int(h * crop_frac)
        left  = rng.randint(0, w - new_w)
        top   = rng.randint(0, h - new_h)
        img = img.crop((left, top, left + new_w, top + new_h))
        return img.resize(TARGET_SIZE)
    elif ops == 13:
        return img.rotate(45)
    elif ops == 14:
        flipped = img.transpose(Image.FLIP_LEFT_RIGHT)
        return ImageEnhance.Brightness(flipped).enhance(1.2)
    elif ops == 15:
        rotated = img.rotate(90)
        return ImageEnhance.Contrast(rotated).enhance(1.2)
    elif ops == 16:
        flipped = img.transpose(Image.FLIP_TOP_BOTTOM)
        return ImageEnhance.Sharpness(flipped).enhance(1.5)
    elif ops == 17:
        return img.rotate(135)
    else:
        return img


# ── Core logic ───────────────────────────────────────────────────────────────

def collect_source_images() -> list[str]:
    images = []
    for fname in os.listdir(SOURCE_DIR):
        ext = os.path.splitext(fname)[1].lower()
        if ext in IMAGE_EXTENSIONS:
            images.append(os.path.join(SOURCE_DIR, fname))
    return images


def split_sources(images: list[str]) -> dict[str, list[str]]:
    rng = random.Random(RANDOM_SEED)
    shuffled = images[:]
    rng.shuffle(shuffled)

    n = len(shuffled)
    n_train = round(n * SPLIT_RATIOS['train'])
    n_valid = round(n * SPLIT_RATIOS['valid'])
    # remaining goes to test
    n_test  = n - n_train - n_valid

    return {
        'train': shuffled[:n_train],
        'valid': shuffled[n_train : n_train + n_valid],
        'test':  shuffled[n_train + n_valid :],
    }


def fill_split(split: str, source_paths: list[str], target_count: int):
    out_dir = os.path.join(DEST_DIR, split, 'random')
    os.makedirs(out_dir, exist_ok=True)

    saved = 0
    aug_counter = 0  # increments across images so aug_id stays unique

    # First pass: save original resized images
    for src_path in source_paths:
        if saved >= target_count:
            break
        try:
            img = load_and_resize(src_path)
            fname = f"random_{split}_{saved:04d}.jpg"
            img.save(os.path.join(out_dir, fname), quality=95)
            saved += 1
        except Exception as e:
            print(f"  ⚠️  Skipped {os.path.basename(src_path)}: {e}")
        aug_counter += 1

    # Subsequent passes: keep augmenting until target reached
    aug_round = 1
    while saved < target_count:
        for idx, src_path in enumerate(source_paths):
            if saved >= target_count:
                break
            try:
                img = load_and_resize(src_path)
                aug_id = aug_round * 100 + idx  # unique id per (round, image)
                aug_img = augment(img, aug_id)
                fname = f"random_{split}_{saved:04d}.jpg"
                aug_img.save(os.path.join(out_dir, fname), quality=95)
                saved += 1
            except Exception as e:
                print(f"  ⚠️  Skipped {os.path.basename(src_path)}: {e}")
        aug_round += 1

    print(f"  ✅ {split.upper():5s}/random → {saved} images saved  (target: {target_count})")


def main():
    print("=" * 60)
    print("  Augment & Distribute → own_dataset / random class")
    print("=" * 60)

    # Collect source images
    sources = collect_source_images()
    print(f"\n📂 Source images found: {len(sources)}  (in randomthings/)")

    if not sources:
        print("❌ No images found in source directory. Aborting.")
        return

    # Split sources
    splits = split_sources(sources)
    print(f"\n📊 Source split:")
    for s, imgs in splits.items():
        print(f"   {s:6s}: {len(imgs):3d} source images  →  target {TARGETS[s]}")

    print("\n🚀 Generating augmented images...\n")
    for split_name, src_list in splits.items():
        fill_split(split_name, src_list, TARGETS[split_name])

    print("\n📋 Final class balance for 'random':")
    print(f"{'SPLIT':<8} | {'CLASS':<12} | {'COUNT':<8} | STATUS")
    print("-" * 45)
    for split_name in ['train', 'valid', 'test']:
        out_dir = os.path.join(DEST_DIR, split_name, 'random')
        count = len([f for f in os.listdir(out_dir)
                     if os.path.splitext(f)[1].lower() in IMAGE_EXTENSIONS])
        status = "✅ OK" if count >= TARGETS[split_name] else "⚠️  LOW"
        print(f"{split_name.upper():<8} | {'random':<12} | {count:<8} | {status}")

    print("\n✅ Done!")


if __name__ == "__main__":
    main()
