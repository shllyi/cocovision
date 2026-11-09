import tensorflow as tf
import numpy as np
from PIL import Image
from ultralytics import YOLO
import io
import os
import asyncio

# Stage 1: Counting/Detection Model
COUNT_MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "models", "coconut_counting.pt")


# Stage 2: Maturity Classification Models (DUAL)
CLASS_MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "models", "coconut_model.h5")
CLASS_MODEL_CUSTOM_PATH = os.path.join(os.path.dirname(__file__), "..", "models", "coconut_model_3class.h5")

# Stage 2b: 4-class filter model (includes "random" class to reject non-coconuts)
CLASS_MODEL_4CLASS_PATH = os.path.join(os.path.dirname(__file__), "..", "models", "coconut_model_4class3.h5")

# Ensure models exist
for path in [COUNT_MODEL_PATH, CLASS_MODEL_PATH, CLASS_MODEL_CUSTOM_PATH, CLASS_MODEL_4CLASS_PATH]:
    if not os.path.exists(path):
        raise FileNotFoundError(f"Model file not found at {path}")

# Load models
counting_model = YOLO(COUNT_MODEL_PATH)
classify_model = tf.keras.models.load_model(CLASS_MODEL_PATH)
classify_model_custom = tf.keras.models.load_model(CLASS_MODEL_CUSTOM_PATH)
classify_model_4class = tf.keras.models.load_model(CLASS_MODEL_4CLASS_PATH)

CLASSES = ['malakanin', 'malauhog', 'niyog']
# Alphabetical order from own_dataset (malakanin, malauhog, niyog, random)
CLASSES_4CLASS = ['malakanin', 'malauhog', 'niyog', 'random']
RANDOM_CLASS = 'random'
ADVICE = {
    "malauhog": "Buko juice stage. The meat is thin and translucent.",
    "malakanin": "Soft meat stage. Perfect for fruit salads and desserts.",
    "niyog": "Mature stage. Best for coconut milk (gata) or oil."
}

def get_top_predictions(predictions, top_n=2):
    """Get top N predictions with labels and confidences"""
    pred_dict = {CLASSES[i]: float(predictions[i]) for i in range(len(CLASSES))}
    sorted_preds = sorted(pred_dict.items(), key=lambda x: x[1], reverse=True)
    return sorted_preds[:top_n]

async def predict_coconut_stage(file):
    # 1. Read and prepare image
    image_data = await file.read()
    await file.seek(0)
    original_img = Image.open(io.BytesIO(image_data)).convert('RGB')
    
    # CRITICAL: Get original dimensions for scaling in frontend
    orig_width, orig_height = original_img.size
    
    # 2. Stage 1: Detect and Count
    def run_counting_model(img):
        return counting_model(img)
    
    results = await asyncio.to_thread(run_counting_model, original_img)
    boxes = results[0].boxes
    count = len(boxes)
    
    detections = []

    # 3. Stage 2: Analyze each coconut with BOTH models
    for box in boxes:
        # Get coordinates [x1, y1, x2, y2]
        coords = box.xyxy[0].tolist()
        x1, y1, x2, y2 = map(int, coords)
        
        # Crop
        crop = original_img.crop((x1, y1, x2, y2))
        
        # Preprocess for Classifier
        crop = crop.resize((224, 224))
        crop_array = np.array(crop) / 255.0
        crop_array = np.expand_dims(crop_array, axis=0).astype(np.float32)

        # Predict with BOTH models
        def run_classify_model(arr, model):
            return model.predict(arr, verbose=0)

        # ── Filter: 4-class model – skip if detected as random ──────────────
        pred_4class = await asyncio.to_thread(run_classify_model, crop_array, classify_model_4class)
        filter_label = CLASSES_4CLASS[int(np.argmax(pred_4class[0]))]
        if filter_label == RANDOM_CLASS:
            continue  # Not a coconut – disregard this detection entirely
        # ─────────────────────────────────────────────────────────────────────

        pred_original = await asyncio.to_thread(run_classify_model, crop_array, classify_model)
        pred_custom = await asyncio.to_thread(run_classify_model, crop_array, classify_model_custom)
        
        # Get top 2 predictions from each model
        top_preds_original = get_top_predictions(pred_original[0], top_n=2)
        top_preds_custom = get_top_predictions(pred_custom[0], top_n=2)
        
        # Main prediction (highest confidence from original model)
        primary_label_original = top_preds_original[0][0]
        primary_conf_original = top_preds_original[0][1]
        
        # Secondary prediction (if confidence < 0.75, show the second highest)
        secondary_label_original = top_preds_original[1][0] if len(top_preds_original) > 1 else None
        secondary_conf_original = top_preds_original[1][1] if len(top_preds_original) > 1 else 0
        
        # Custom model predictions
        primary_label_custom = top_preds_custom[0][0]
        primary_conf_custom = top_preds_custom[0][1]
        secondary_label_custom = top_preds_custom[1][0] if len(top_preds_custom) > 1 else None
        secondary_conf_custom = top_preds_custom[1][1] if len(top_preds_custom) > 1 else 0
        
        detections.append({
            "box": coords,
            # Original Model Results
            "original_model": {
                "primary": {
                    "label": primary_label_original,
                    "confidence": primary_conf_original
                },
                "secondary": {
                    "label": secondary_label_original,
                    "confidence": secondary_conf_original
                } if secondary_label_original else None,
                "description": ADVICE.get(primary_label_original, "Stage detected.")
            },
            # Custom Model Results
            "custom_model": {
                "primary": {
                    "label": primary_label_custom,
                    "confidence": primary_conf_custom
                },
                "secondary": {
                    "label": secondary_label_custom,
                    "confidence": secondary_conf_custom
                } if secondary_label_custom else None,
                "description": ADVICE.get(primary_label_custom, "Stage detected.")
            }
        })

    return {
        "count": len(detections),
        "detections": detections,
        "summary": f"Found {len(detections)} coconut(s)." if len(detections) > 0 else "No coconuts detected.",
        "image_size": {"width": orig_width, "height": orig_height} 
    }