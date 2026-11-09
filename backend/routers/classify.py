from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Header
from services import classifier, scans, live_classifier
from schemas.scans import ScanCreate
from database import get_db
from typing import Optional, List, Dict, Any
import logging
import cloudinary
import cloudinary.uploader
from config import settings
from services.deps import require_admin, current_user_id

# Set up logging to see errors in your terminal
logger = logging.getLogger("uvicorn")

# Initialize Cloudinary if not already done
cloudinary.config(
    cloud_name=settings.cloudinary_cloud_name,
    api_key=settings.cloudinary_api_key,
    api_secret=settings.cloudinary_api_secret,
    secure=True
)

router = APIRouter()

@router.post("/image")
async def classify_coconut(file: UploadFile = File(...)):
    # 1. Log what we received
    logger.info(f"Received request with content-type: {file.content_type}")
    logger.info(f"Filename: {file.filename}")
    logger.info(f"File size: {file.file.seek(0, 2)} bytes")
    file.file.seek(0)
    
    # 2. Validate File Type BEFORE processing
    if not file.content_type or not file.content_type.startswith("image/"):
        logger.error(f"Invalid file type: {file.content_type}")
        raise HTTPException(status_code=400, detail="File provided is not an image.")

    try:
        logger.info(f"Processing file: {file.filename}")
        
        # 3. Call the AI service (returns count, detections, summary with dual models)
        result = await classifier.predict_coconut_stage(file)
        logger.info(f"Classification complete. Found {result.get('count', 0)} coconuts.")
        
        # 4. Return the result
        return result

    except Exception as e:
        logger.error(f"Classification error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"AI Model Error: {str(e)}")


@router.post("/save-scan")
async def save_scan(
    scan_data: ScanCreate,
    user_id: str = Depends(current_user_id),
    db = Depends(get_db)
):
    """Save a classification scan to user's history"""
    
    # Save the scan using the service, including image dimensions so we can re-draw boxes later
    result = await scans.save_scan_logic(
        user_id=user_id,
        image_url=scan_data.image_url,
        detections=scan_data.detections,
        total_count=scan_data.total_count,
        db=db,
        image_width=scan_data.image_width,
        image_height=scan_data.image_height,
    )
    
    return result


@router.post("/upload-image")
async def upload_scan_image(
    file: UploadFile = File(...),
    user_id: str = Depends(current_user_id),
):
    """Upload scan image to Cloudinary"""
    
    try:
        # Validate file type
        if not file.content_type or not file.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="File provided is not an image.")
        
        # Read file content
        file_content = await file.read()
        
        # Upload to Cloudinary
        upload_result = cloudinary.uploader.upload(
            file_content,
            resource_type="auto",
            folder="cocotry/scans",
            public_id=f"scan_{user_id}_{int(__import__('time').time())}"
        )
        
        return {
            "status": "success",
            "image_url": upload_result.get("secure_url"),
            "secure_url": upload_result.get("secure_url")
        }
    except HTTPException:
        raise

    except Exception as e:
        logger.error(f"Image upload error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Image upload failed: {str(e)}")


@router.get("/scans")
async def get_user_scans(
    user_id: str = Depends(current_user_id),
    db = Depends(get_db)
):
    """Get all scans for the authenticated user"""
    
    result = await scans.get_user_scans_logic(user_id, db)
    return result

#live classifier route
@router.delete("/scans/{scan_id}")
async def delete_scan(
    scan_id: str,
     user_id: str = Depends(current_user_id),
    db = Depends(get_db)
):
    """Delete a specific scan"""
    
    result = await scans.delete_scan_logic(scan_id, user_id, db)
    return result

@router.post("/frame")
async def classify_frame(file: UploadFile = File(...), fast: bool = True):
    """Live camera frame. No save, no Cloudinary."""
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty frame.")
    if len(data) > 3 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Frame too large.")
    try:
        return await live_classifier.predict_frame(data, fast)
    except Exception as e:
        logger.error(f"Frame error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"AI Model Error: {e}")