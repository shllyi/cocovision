from pydantic import BaseModel, EmailStr
from typing import Optional

# 1. Registration Schema
class UserRegister(BaseModel):
    fullName: str
    email: EmailStr
    phoneNumber: str
    location: str
    password: str
    confirmPassword: str

# 2. Standard Login Schema
class UserLogin(BaseModel):
    email: EmailStr
    password: str

# 3. Google Login Schema (NEW)
class GoogleLoginRequest(BaseModel):
    token: str  # This receives the Firebase ID Token