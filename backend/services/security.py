import os
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt  # PyJWT

from config import settings

JWT_SECRET = settings.jwt_secret
JWT_ALG = "HS256"
JWT_HOURS = 24 * 7


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except ValueError:
        return False  # stored value is not a bcrypt hash (legacy plaintext)


def is_hashed(value: str) -> bool:
    return value.startswith(("$2a$", "$2b$", "$2y$"))


def create_token(user_id: str, role: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": user_id, "role": role, "iat": now, "exp": now + timedelta(hours=JWT_HOURS)}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str) -> dict:
    # raises jwt.InvalidTokenError (incl. expired) on bad input
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])