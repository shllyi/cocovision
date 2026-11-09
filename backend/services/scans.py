from fastapi import HTTPException
from bson import ObjectId
from datetime import datetime
from typing import List, Dict, Any, Optional


async def save_scan_logic(
    user_id: str,
    image_url: str,
    detections: List[Dict[str, Any]],
    total_count: int,
    db,
    image_width: Optional[int] = None,
    image_height: Optional[int] = None,
):
    """Save a classification scan to the database, including bounding boxes and image size."""

    try:
        # Validate user exists
        user_oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID")

    # Check if user exists
    user = await db.users.find_one({"_id": user_oid})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Convert Pydantic models to dictionaries if needed
    detections_list: List[Dict[str, Any]] = []
    for detection in detections:
        if hasattr(detection, "dict"):
            detections_list.append(detection.dict())
        else:
            detections_list.append(detection)

    # Create scan document
    scan_document: Dict[str, Any] = {
        "user_id": user_oid,
        "image_url": image_url,
        "detections": detections_list,
        "total_count": total_count,
        "timestamp": datetime.utcnow(),
    }

    # Persist image dimensions if provided
    if image_width is not None and image_height is not None:
        scan_document["image_width"] = image_width
        scan_document["image_height"] = image_height

    # Insert into database
    result = await db.scans.insert_one(scan_document)

    return {
        "status": "success",
        "message": "Scan saved successfully",
        "scan_id": str(result.inserted_id),
    }

async def get_user_scans_logic(user_id: str, db):
    """Retrieve all scans for a user"""
    
    try:
        user_oid = ObjectId(user_id)
    except:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    
    # Check if user exists
    user = await db.users.find_one({"_id": user_oid})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Find all scans for this user
    scans = await db.scans.find({"user_id": user_oid}).sort("timestamp", -1).to_list(None)
    
    # Convert ObjectId to string
    for scan in scans:
        scan["_id"] = str(scan["_id"])
        scan["user_id"] = str(scan["user_id"])
    
    return {
        "status": "success",
        "scans": scans,
        "count": len(scans)
    }

async def delete_scan_logic(scan_id: str, user_id: str, db):
    """Delete a specific scan (only by the owner)"""
    
    try:
        scan_oid = ObjectId(scan_id)
        user_oid = ObjectId(user_id)
    except:
        raise HTTPException(status_code=400, detail="Invalid ID format")
    
    scan = await db.scans.find_one({"_id": scan_oid})
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")

    if scan.get("user_id") != user_oid:
        raise HTTPException(status_code=403, detail="Unauthorized: You can only delete your own scans")

    delete_result = await db.scans.delete_one({"_id": scan_oid, "user_id": user_oid})
    if delete_result.deleted_count != 1:
        raise HTTPException(status_code=500, detail="Failed to delete scan")

    return {
        "status": "success",
        "message": "Scan deleted successfully"
    }
