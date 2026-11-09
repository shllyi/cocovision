from fastapi import APIRouter, Depends
from database import get_db
from services.deps import current_user_id
from services.notifications import (
    get_user_notifications,
    get_unread_count,
    mark_notification_read,
    mark_all_read as mark_all_read_service,
)

router = APIRouter()



# ── GET all notifications for the current user ────────────────────────────────
@router.get("")
async def get_notifications(user_id: str = Depends(current_user_id), db=Depends(get_db)):
    notifications = await get_user_notifications(db, user_id)
    return {"status": "success", "notifications": notifications}


# ── GET unread count ──────────────────────────────────────────────────────────
@router.get("/unread-count")
async def unread_count(user_id: str = Depends(current_user_id), db=Depends(get_db)):
    count = await get_unread_count(db, user_id)
    return {"status": "success", "count": count}


# ── MARK ALL as read — MUST be declared before /{notification_id}/read ────────
@router.put("/read-all")
async def mark_all_read(user_id: str = Depends(current_user_id), db=Depends(get_db)):
    return await mark_all_read_service(db, user_id)



# ── MARK single notification as read ─────────────────────────────────────────
@router.put("/{notification_id}/read")
async def mark_read(notification_id: str, user_id: str = Depends(current_user_id), db=Depends(get_db)):
    return await mark_notification_read(db, notification_id, user_id)

