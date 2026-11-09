# backend/database.py
from motor.motor_asyncio import AsyncIOMotorClient
from config import settings

client = AsyncIOMotorClient(settings.mongodb_url)
db = client[settings.database_name]

def get_db():
    return db