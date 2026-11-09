import os

# 1. SETUP YOUR PATHS
IMAGE_DATASET_DIR = r"S:\REPOSITORIES\cocovision\backend\ml_training\own_dataset"
AUDIO_DATASET_DIR = r"S:\REPOSITORIES\cocovision\backend\ml_training\acoustic_new"

def check_dataset_balance(base_dir, extensions, item_label):
    splits = ['train', 'valid', 'test']
    
    print(f"\n📊 DATASET BALANCE REPORT")
    print(f"📍 Location: {base_dir}\n")
    print(f"{'SPLIT':<10} | {'CLASS':<15} | {'COUNT':<10} | {'STATUS'}")
    print("-" * 55)

    grand_total = 0
    warning_flag = False

    for split in splits:
        split_path = os.path.join(base_dir, split)
        
        if not os.path.exists(split_path):
            print(f"{split.upper():<10} | {'(Missing)':<15} | {'0':<10} | ❌ Not Found")
            continue

        # Get all class folders in this split
        classes = [d for d in os.listdir(split_path) if os.path.isdir(os.path.join(split_path, d))]
        
        if not classes:
             print(f"{split.upper():<10} | {'(Empty)':<15} | {'0':<10} | ⚠️ No classes")
             continue

        # Count files in each class matching provided extensions
        split_counts = {}
        for cls in classes:
            class_path = os.path.join(split_path, cls)
            count = len([f for f in os.listdir(class_path) if any(f.lower().endswith(ext) for ext in extensions)])
            split_counts[cls] = count
            grand_total += count

        # Calculate average for this split to find outliers
        avg_count = sum(split_counts.values()) / len(split_counts) if split_counts else 0

        for cls, count in split_counts.items():
            # Check for imbalance (if a class is < 50% of the average)
            status = "✅ OK"
            if count < (avg_count * 0.5):
                status = "⚠️ LOW"
                warning_flag = True
            elif count > (avg_count * 1.5):
                status = "⚠️ HIGH"
            
            print(f"{split.upper():<10} | {cls:<15} | {count:<10} | {status}")
        
        print("-" * 55)

    print(f"\nTotal {item_label}: {grand_total}")
    if warning_flag:
        print("\n📢 ADVICE: You have some imbalanced classes (marked ⚠️ LOW).")
        print(f"   Consider adding more {item_label.lower()} or augmenting those specific classes more.")
    else:
        print("\n🎉 Great! Your dataset looks relatively balanced.")

if __name__ == "__main__":
    image_extensions = ['.jpg', '.jpeg', '.png', '.bmp', '.webp']
    audio_extensions = ['.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac']

    print("\n================ IMAGE DATASET (own_dataset) ================")
    check_dataset_balance(IMAGE_DATASET_DIR, image_extensions, "Images")

    print("\n================ AUDIO DATASET (acoustic_new) ================")
    check_dataset_balance(AUDIO_DATASET_DIR, audio_extensions, "Audio Files")