import io
import time
import asyncio
 
import numpy as np
from PIL import Image, ImageOps
 
from services import classifier as c
 
MAX_SIDE = 416      # frames are downscaled to this on the long side
YOLO_CONF = 0.35    # raise to cut false boxes, lower to catch more
MIN_BOX = 8         # ignore tiny boxes (px)
 
_lock = asyncio.Lock()
 
 
def _top2(p):
    idx = np.argsort(p)[::-1][:2]
    return [(c.CLASSES[int(i)], float(p[int(i)])) for i in idx]
 
 
def _model_block(p):
    top = _top2(p)
    return {
        "primary": {"label": top[0][0], "confidence": top[0][1]},
        "secondary": {"label": top[1][0], "confidence": top[1][1]},
        "description": c.ADVICE.get(top[0][0], "Stage detected."),
    }
 
 
def _run(image_bytes: bytes, fast: bool = True) -> dict:
    t0 = time.perf_counter()
 
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes))).convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    w, h = img.size
 
    # Stage 1: detect
    res = c.counting_model(img, imgsz=MAX_SIDE, conf=YOLO_CONF, verbose=False)
    boxes = res[0].boxes
 
    crops, coords = [], []
    for b in boxes:
        x1, y1, x2, y2 = b.xyxy[0].tolist()
        x1, y1 = max(0, int(x1)), max(0, int(y1))
        x2, y2 = min(w, int(x2)), min(h, int(y2))
        if (x2 - x1) < MIN_BOX or (y2 - y1) < MIN_BOX:
            continue
        crop = img.crop((x1, y1, x2, y2)).resize((224, 224))
        crops.append(np.asarray(crop, dtype=np.float32) / 255.0)
        coords.append([float(x1), float(y1), float(x2), float(y2)])
 
    detections = []
    if crops:
        batch = np.stack(crops)
 
        # Stage 2a: drop "random" (non-coconut) crops
        p4 = c.classify_model_4class(batch, training=False).numpy()
        keep = [
            i for i in range(len(crops))
            if c.CLASSES_4CLASS[int(np.argmax(p4[i]))] != c.RANDOM_CLASS
        ]
 
        # Stage 2b: maturity, both models, one call each
        if keep:
            kb = batch[keep]
            pc = c.classify_model_custom(kb, training=False).numpy()
            po = pc if fast else c.classify_model(kb, training=False).numpy()
            for j, i in enumerate(keep):
                detections.append({
                    "box": coords[i],
                    "original_model": _model_block(po[j]),
                    "custom_model": _model_block(pc[j]),
                })
 
    return {
        "count": len(detections),
        "detections": detections,
        "summary": f"Found {len(detections)} coconut(s)." if detections else "No coconuts detected.",
        "image_size": {"width": w, "height": h},
        "ms": int((time.perf_counter() - t0) * 1000),
    }
 
 
async def predict_frame(image_bytes: bytes, fast: bool = True) -> dict:
    async with _lock:
        return await asyncio.to_thread(_run, image_bytes, fast)
 
 
def warmup():
    """Run one dummy frame so the first real request is not slow."""
    buf = io.BytesIO()
    Image.new("RGB", (MAX_SIDE, MAX_SIDE), (90, 90, 90)).save(buf, format="JPEG")
    _run(buf.getvalue())