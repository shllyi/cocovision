import os
import shutil
from PIL import Image
from pathlib import Path
import random

# Setup paths
NEW_DATASET_DIR = r"S:\REPOSITORIES\cocovision\backend\ml_training\new"
OWN_DATASET_DIR = r"S:\REPOSITORIES\cocovision\backend\ml_training\own_dataset"

# Configuration
TARGET_SIZE = (224, 224)
TRAIN_VALID_SPLIT = 0.8  # 80% to train, 20% to valid
AUGMENTATION_COUNT = 3   # Number of augmented versions per original image
extensions = ['.jpg', '.jpeg', '.png', '.bmp', '.webp']
classes = ['malakanin', 'malauhog', 'niyog']


def augment_image(img, variation_num):
    """Create variations of an image for augmentation"""
    augmented_images = {
        'original': img,
        'rot90': img.rotate(90),
        'rot180': img.rotate(180),
        'rot270': img.rotate(270),
        'flipH': img.transpose(Image.FLIP_LEFT_RIGHT),
        'flipV': img.transpose(Image.FLIP_TOP_BOTTOM),
        'bright': Image.eval(img, lambda p: min(255, int(p * 1.1))),  # Brighter
    }
    return augmented_images


def distribute_augmented_images():
    """
    Read images from new/train/[class]/
    Augment them
    Distribute to own_dataset/train and own_dataset/valid
    """
    
    total_distributed = 0
    
    # Process each class
    for class_name in classes:
        source_dir = os.path.join(NEW_DATASET_DIR, 'train', class_name)
        
        if not os.path.exists(source_dir):
            print(f"⚠️ Warning: {source_dir} not found")
            continue
        
        print(f"\n🔄 Processing class: {class_name.upper()}")
        print(f"📂 Source: {source_dir}")
        
        # Get all image files
        image_files = [f for f in os.listdir(source_dir) 
                      if any(f.lower().endswith(ext) for ext in extensions)]
        
        if not image_files:
            print(f"⚠️ No images found in {source_dir}")
            continue
        
        print(f"📸 Found {len(image_files)} original images")
        
        # Create train/valid split
        random.shuffle(image_files)
        split_idx = int(len(image_files) * TRAIN_VALID_SPLIT)
        train_files = image_files[:split_idx]
        valid_files = image_files[split_idx:]
        
        print(f"✅ Split: {len(train_files)} → train, {len(valid_files)} → valid")
        
        # Process training images
        train_target = os.path.join(OWN_DATASET_DIR, 'train', class_name)
        os.makedirs(train_target, exist_ok=True)
        total_distributed += process_images(train_files, source_dir, train_target, 
                                           class_name, 'TRAIN', augment=True)
        
        # Process validation images
        valid_target = os.path.join(OWN_DATASET_DIR, 'valid', class_name)
        os.makedirs(valid_target, exist_ok=True)
        total_distributed += process_images(valid_files, source_dir, valid_target, 
                                           class_name, 'VALID', augment=False)
    
    print(f"\n✨ SUCCESS! Distributed {total_distributed} images total.")
    print(f"📁 Check: {OWN_DATASET_DIR}")


def process_images(file_list, source_dir, target_dir, class_name, subset_name, augment=False):
    """
    Process images: resize, augment (if needed), and save
    
    Args:
        file_list: List of image filenames to process
        source_dir: Source directory path
        target_dir: Target directory path
        class_name: Class name (for logging)
        subset_name: 'TRAIN' or 'VALID' (for logging)
        augment: Whether to create augmented versions
    """
    count = 0
    
    for filename in file_list:
        file_path = os.path.join(source_dir, filename)
        base_name = os.path.splitext(filename)[0]
        
        try:
            # Resize image
            img = Image.open(file_path).convert('RGB')
            img = img.resize(TARGET_SIZE)
            
            # Save original resized image
            original_save = os.path.join(target_dir, f"{base_name}.jpg")
            img.save(original_save, quality=95)
            count += 1
            print(f"  ✓ {base_name}.jpg → {subset_name}")
            
            # Create augmented versions only for training
            if augment:
                augmented_versions = augment_image(img, 1)
                
                # Save augmented versions
                aug_variants = {
                    'rot90': augmented_versions['rot90'],
                    'rot180': augmented_versions['rot180'],
                    'rot270': augmented_versions['rot270'],
                    'flipH': augmented_versions['flipH'],
                    'flipV': augmented_versions['flipV'],
                }
                
                for aug_name, aug_img in aug_variants.items():
                    aug_path = os.path.join(target_dir, f"{base_name}_{aug_name}.jpg")
                    aug_img.save(aug_path, quality=95)
                    count += 1
                    print(f"  ✓ {base_name}_{aug_name}.jpg → {subset_name}")
        
        except Exception as e:
            print(f"  ❌ Error processing {filename}: {e}")
    
    return count


if __name__ == "__main__":
    print("=" * 60)
    print("🚀 AUGMENT & DISTRIBUTE NEW IMAGES")
    print("=" * 60)
    print(f"📌 Source: {NEW_DATASET_DIR}/train/[class]/")
    print(f"📌 Target: {OWN_DATASET_DIR}/[train|valid]/[class]/")
    print(f"📌 Train/Valid Split: {TRAIN_VALID_SPLIT:.0%}/{1-TRAIN_VALID_SPLIT:.0%}")
    print("=" * 60)
    
    distribute_augmented_images()
