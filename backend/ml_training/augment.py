import os
from PIL import Image

# 1. SETUP YOUR PATH
DATASET_DIR = r"S:\REPOSITORIES\cocovision\backend\ml_training\own_dataset"

def process_and_augment(base_dir):
    # Standard size for MobileNetV2
    TARGET_SIZE = (224, 224)
    
    # Image types to look for
    extensions = ['.jpg', '.jpeg', '.png', '.bmp', '.webp']
    
    # Folders to process
    subsets = ['train', 'valid', 'test']
    
    total_count = 0

    for subset in subsets:
        subset_path = os.path.join(base_dir, subset)
        
        if not os.path.exists(subset_path):
            print(f"⚠️ Warning: '{subset}' folder not found in {base_dir}")
            continue

        print(f"\n🚀 Processing {subset.upper()} set...")

        # Walk through all class folders (e.g., malauhog, niyog)
        for root, dirs, files in os.walk(subset_path):
            for filename in files:
                if any(filename.lower().endswith(ext) for ext in extensions):
                    file_path = os.path.join(root, filename)
                    
                    try:
                        # --- PREPROCESSING ---
                        img = Image.open(file_path).convert('RGB')
                        img = img.resize(TARGET_SIZE)
                        
                        # Save the resized original (overwriting old large file to save space)
                        # If you want to keep original quality, change filename to f"{name}_resized.jpg"
                        base_name = os.path.splitext(filename)[0]
                        img.save(file_path, quality=95) 

                        # --- AUGMENTATION ---
                        # Only augment 'train' data usually, but you can do all if data is scarce
                        if subset == 'train':
                            # 1. Rotations
                            for angle in [90, 180, 270]:
                                save_path = os.path.join(root, f"{base_name}_rot{angle}.jpg")
                                if not os.path.exists(save_path):
                                    img.rotate(angle).save(save_path)
                                    total_count += 1

                            # 2. Horizontal Flip
                            flip_path = os.path.join(root, f"{base_name}_flipH.jpg")
                            if not os.path.exists(flip_path):
                                img.transpose(Image.FLIP_LEFT_RIGHT).save(flip_path)
                                total_count += 1
                                
                    except Exception as e:
                        print(f"❌ Error on {filename}: {e}")

    print(f"\n✅ SUCCESS: Added {total_count} new augmented images!")
    print(f"All images resized to {TARGET_SIZE} for faster training.")

if __name__ == "__main__":
    process_and_augment(DATASET_DIR)