from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import Optional

class PostCreate(BaseModel):
    title: str
    description: str
    author_name: str
    author_email: EmailStr

class PostResponse(BaseModel):
    id: str
    title: str
    description: str
    image_url: str
    author_name: str
    author_email: str
    timestamp: datetime
    
    class Config:
        from_attributes = True