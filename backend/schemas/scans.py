from pydantic import BaseModel
from datetime import datetime
from typing import List, Optional, Dict, Any


class DetectionData(BaseModel):
    """
    Single detection result for a coconut in an image.
    Now includes the bounding box so we can render it again in history views.
    """
    label: str
    confidence: float
    description: str
    # [x1, y1, x2, y2] in original image pixel coordinates
    box: Optional[List[float]] = None


class DetectionDetail(BaseModel):
    box: List[float]
    original_model: Dict[str, Any]
    custom_model: Dict[str, Any]


class ScanCreate(BaseModel):
    """
    Payload sent from the frontend when saving a scan.
    Includes image dimensions so bounding boxes can be re-drawn later.
    """
    image_url: str
    detections: List[Dict[str, Any]]
    total_count: int
    image_width: Optional[int] = None
    image_height: Optional[int] = None


class ScanResponse(BaseModel):
    """
    Scan document returned to the frontend when fetching history.
    image_width/height are optional for backwards compatibility with old scans.
    """
    id: str
    user_id: str
    image_url: str
    detections: List[Dict[str, Any]]
    total_count: int
    created_at: str

    class Config:
        from_attributes = True
