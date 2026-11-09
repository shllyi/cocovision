"""
Notification Service
Handles creating, fetching, and marking notifications as read.

recipient_id = specific user_id   → personal notification
recipient_id = "broadcast"        → sent to ALL users
"""

from datetime import datetime, timezone
from bson import ObjectId
from fastapi import HTTPException


# ─────────────────────────────────────────────────────────────────────────────
# CREATE
# ─────────────────────────────────────────────────────────────────────────────

async def create_notification(
    db,
    recipient_id: str,   # user_id OR "broadcast"
    notif_type: str,
    title: str,
    message: str,
    data: dict = None,
):
    """Insert one notification document into MongoDB."""
    doc = {
        "recipient_id": recipient_id,
        "type": notif_type,
        "title": title,
        "message": message,
        "data": data or {},
        # For personal notifications:  is_read bool
        # For broadcast notifications: read_by  list (stores user_ids that already read it)
        "is_read": False,
        "read_by": [],
        "created_at": datetime.now(timezone.utc),  # timezone-aware → serialises with +00:00
    }
    await db.notifications.insert_one(doc)


async def broadcast_notification(db, notif_type: str, title: str, message: str, data: dict = None):
    """Convenience shortcut to create a broadcast notification."""
    await create_notification(db, "broadcast", notif_type, title, message, data)


# ─────────────────────────────────────────────────────────────────────────────
# FETCH
# ─────────────────────────────────────────────────────────────────────────────

async def get_user_notifications(db, user_id: str, limit: int = 50):
    """Return all notifications for a user (personal + broadcasts), newest first."""
    cursor = db.notifications.find(
        {"$or": [{"recipient_id": user_id}, {"recipient_id": "broadcast"}]}
    ).sort("created_at", -1).limit(limit)

    docs = await cursor.to_list(length=limit)
    result = []
    for doc in docs:
        is_broadcast = doc["recipient_id"] == "broadcast"
        is_read = (user_id in doc.get("read_by", [])) if is_broadcast else doc.get("is_read", False)
        result.append({
            "id": str(doc["_id"]),
            "recipient_id": doc["recipient_id"],
            "type": doc["type"],
            "title": doc["title"],
            "message": doc["message"],
            "data": doc.get("data", {}),
            "is_read": is_read,
            "created_at": doc["created_at"].isoformat(),
        })
    return result


async def get_unread_count(db, user_id: str) -> int:
    """Return number of unread notifications for a user."""
    # Personal unread
    personal_unread = await db.notifications.count_documents(
        {"recipient_id": user_id, "is_read": False}
    )
    # Broadcast unread (user_id NOT in read_by)
    broadcast_unread = await db.notifications.count_documents(
        {"recipient_id": "broadcast", "read_by": {"$nin": [user_id]}}
    )
    return personal_unread + broadcast_unread


# ─────────────────────────────────────────────────────────────────────────────
# MARK READ
# ─────────────────────────────────────────────────────────────────────────────

async def mark_notification_read(db, notification_id: str, user_id: str):
    """Mark a single notification as read for the given user."""
    try:
        oid = ObjectId(notification_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid notification ID")

    doc = await db.notifications.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Notification not found")

    if doc["recipient_id"] == "broadcast":
        # Add user_id to read_by list (if not already there)
        await db.notifications.update_one(
            {"_id": oid},
            {"$addToSet": {"read_by": user_id}}
        )
    else:
        # Personal notification — just flip the flag
        await db.notifications.update_one(
            {"_id": oid},
            {"$set": {"is_read": True}}
        )

    return {"status": "success"}


async def mark_all_read(db, user_id: str):
    """Mark all of a user's unread notifications as read."""
    # Personal
    await db.notifications.update_many(
        {"recipient_id": user_id, "is_read": False},
        {"$set": {"is_read": True}}
    )
    # Broadcast — add user_id to read_by for every unread broadcast
    await db.notifications.update_many(
        {"recipient_id": "broadcast", "read_by": {"$nin": [user_id]}},
        {"$addToSet": {"read_by": user_id}}
    )
    return {"status": "success"}
