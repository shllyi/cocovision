from typing import Optional

import jwt
from bson import ObjectId
from fastapi import Depends, Header, HTTPException

from database import get_db
from services.security import decode_token
from config import settings

ALLOW_LEGACY = settings.allow_legacy_bearer == "1"

# Migration switch. Set ALLOW_LEGACY_BEARER=0 once every screen sends the token.
ALLOW_LEGACY = settings.allow_legacy_bearer == "1" 


async def get_current_user(authorization: Optional[str] = Header(None), db=Depends(get_db)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    raw = authorization[7:].strip()

    uid = None
    try:
        uid = decode_token(raw)["sub"]
    except jwt.InvalidTokenError:
        if ALLOW_LEGACY and ObjectId.is_valid(raw):
            uid = raw
    if not uid or not ObjectId.is_valid(uid):
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user = await db.users.find_one({"_id": ObjectId(uid)})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if user.get("is_active") is False:
        raise HTTPException(status_code=403, detail="Account deactivated")
    user["id"] = str(user["_id"])
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    # Role comes from the DB, not the token, so a demotion applies immediately.
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user

async def current_user_id(user: dict = Depends(get_current_user)) -> str:
    return user["id"]