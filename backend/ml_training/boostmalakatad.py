import os
from PIL import Image, ImageEnhance

# 1. SETUP YOUR PATH
DATASET_DIR = r"S:\REPOSITORIES\cocovision\backend\ml_training\own_dataset"

def boost_minority_class(base_dir, target_class="malakatad", target_count=1000):
    """
    Aggressively augments ONLY the target_class in the TRAIN folder 
    to reach a similar count to other classes.
    """
    
    # We only boost the TRAINING set
    class_dir = os.path.join(base_dir, "train", target_class)
    
    if not os.path.exists(class_dir):
        print(f"❌ Error: Could not find folder {class_dir}")
        return

    # Get list of existing images
    extensions = ['.jpg', '.jpeg', '.png']
    images = [f for f in os.listdir(class_dir) if any(f.lower().endswith(ext) for ext in extensions)]
    
    current_count = len(images)
    print(f"📉 Current {target_class} count: {current_count}")
    
    if current_count >= target_count:
        print("✅ Count is already high enough. No boosting needed.")
        return

    print(f"🚀 Boosting {target_class} to approx {target_count} images...")
    
    generated = 0
    
    # Iterate through existing images and create variations until we hit the target
    for filename in images:
        if generated + current_count >= target_count:
            break
            
        try:
            file_path = os.path.join(class_dir, filename)
            img = Image.open(file_path).convert('RGB')
            base_name = os.path.splitext(filename)[0]

            # Variation 1: Brightness UP
            bright_name = f"{base_name}_bright.jpg"
            if not os.path.exists(os.path.join(class_dir, bright_name)):
                enhancer = ImageEnhance.Brightness(img)
                enhancer.enhance(1.3).save(os.path.join(class_dir, bright_name))
                generated += 1

            # Variation 2: Brightness DOWN
            dark_name = f"{base_name}_dark.jpg"
            if not os.path.exists(os.path.join(class_dir, dark_name)):
                enhancer = ImageEnhance.Brightness(img)
                enhancer.enhance(0.7).save(os.path.join(class_dir, dark_name))
                generated += 1

            # Variation 3: Contrast UP
            cont_name = f"{base_name}_cont.jpg"
            if not os.path.exists(os.path.join(class_dir, cont_name)):
                enhancer = ImageEnhance.Contrast(img)
                enhancer.enhance(1.4).save(os.path.join(class_dir, cont_name))
                generated += 1
                
        except Exception as e:
            print(f"Error processing {filename}: {e}")

    final_count = len([f for f in os.listdir(class_dir) if any(f.lower().endswith(ext) for ext in extensions)])
    print(f"\n✅ FINISHED! {target_class} count increased from {current_count} to {final_count}")

if __name__ == "__main__":
    boost_minority_class(DATASET_DIR)