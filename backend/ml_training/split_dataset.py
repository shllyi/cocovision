"""
Splits images from train/ into valid/ and test/ per class.
Ratio: 75% train | 15% valid | 10% test

Run once:  python split_dataset.py
"""
import os
import shutil
import random

BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
DATASET    = os.path.join(BASE_DIR, 'new')
TRAIN_DIR  = os.path.join(DATASET, 'train')
VALID_DIR  = os.path.join(DATASET, 'valid')
TEST_DIR   = os.path.join(DATASET, 'test')

VALID_RATIO = 0.15
TEST_RATIO  = 0.10

random.seed(42)

classes = [d for d in os.listdir(TRAIN_DIR)
           if os.path.isdir(os.path.join(TRAIN_DIR, d))]

print(f"Found classes: {classes}\n")

for cls in classes:
    src_dir = os.path.join(TRAIN_DIR, cls)
    all_files = [f for f in os.listdir(src_dir)
                 if os.path.isfile(os.path.join(src_dir, f))]
    random.shuffle(all_files)

    n_total = len(all_files)
    n_test  = max(1, int(n_total * TEST_RATIO))
    n_valid = max(1, int(n_total * VALID_RATIO))

    test_files  = all_files[:n_test]
    valid_files = all_files[n_test:n_test + n_valid]

    for split, files in [('valid', valid_files), ('test', test_files)]:
        dst_dir = os.path.join(DATASET, split, cls)
        os.makedirs(dst_dir, exist_ok=True)
        for f in files:
            shutil.move(os.path.join(src_dir, f), os.path.join(dst_dir, f))

    remaining = n_total - n_test - n_valid
    print(f"  {cls}: {n_total} total → {remaining} train | {n_valid} valid | {n_test} test")

print("\nDone! Dataset split complete.")
