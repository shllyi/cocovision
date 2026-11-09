from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

class NotificationCreate(BaseModel):
    """Internal schema for creating a notification"""
    recipient_id: str           # user_id  OR  "broadcast" for all users
    type: str                   # 'like' | 'comment' | 'copra_price' | 'waste_price' | 'role_change' | 'profile_update' | 'login_device'
    title: str
    message: str
    data: Optional[dict] = None # extra context (post_id, product_id, etc.)

class NotificationResponse(BaseModel):
    id: str
    recipient_id: str
    type: str
    title: str
    message: str
    data: Optional[dict] = None
    is_read: bool = False
    created_at: datetime

    class Config:
        from_attributes = True
