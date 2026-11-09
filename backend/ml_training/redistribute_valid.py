"""
redistribute_valid.py
Moves images from own_dataset/train/ → own_dataset/valid/
so each class reaches ~20% of its total in the validation set.
Run this ONCE before training.
"""

import os
import shutil
import random

random.seed(42)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TRAIN_DIR = os.path.join(BASE_DIR, 'own_dataset', 'train')
VALID_DIR = os.path.join(BASE_DIR, 'own_dataset', 'valid')

IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.bmp', '.webp'}
TARGET_VALID_RATIO = 0.20

print("=" * 50)
print("Redistributing train → valid (target: 20% per class)")
print("=" * 50)

for cls in sorted(os.listdir(TRAIN_DIR)):
    train_cls = os.path.join(TRAIN_DIR, cls)
    valid_cls = os.path.join(VALID_DIR, cls)

    if not os.path.isdir(train_cls):
        continue

    os.makedirs(valid_cls, exist_ok=True)

    train_imgs = [f for f in os.listdir(train_cls) if os.path.splitext(f)[1].lower() in IMAGE_EXTS]
    valid_imgs = [f for f in os.listdir(valid_cls) if os.path.splitext(f)[1].lower() in IMAGE_EXTS]

    total = len(train_imgs) + len(valid_imgs)
    target_valid = int(total * TARGET_VALID_RATIO)
    to_move = target_valid - len(valid_imgs)

    if to_move <= 0:
        print(f"  {cls:15s} — already OK  ({len(valid_imgs)} valid / {total} total)")
        continue

    chosen = random.sample(train_imgs, min(to_move, len(train_imgs)))
    for fname in chosen:
        shutil.move(os.path.join(train_cls, fname), os.path.join(valid_cls, fname))

    new_valid = len(valid_imgs) + len(chosen)
    new_train = len(train_imgs) - len(chosen)
    print(f"  {cls:15s} — moved {len(chosen):3d} images  →  train: {new_train}, valid: {new_valid}  ({new_valid/total*100:.0f}%)")

print("=" * 50)
print("Done! Now run train_model2.py")
