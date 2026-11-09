from dotenv import load_dotenv
load_dotenv()
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
import cloudinary
import cloudinary.uploader
import asyncio
from database import get_db
from config import settings
from routers import auth, posts, classify, acoustic, wasteproduct, news
from routers.ai_chat import router as ai_router
from routers.analytics import router as analytics_router
from routers.notifications import router as notifications_router
from services.posts import get_single_post_logic
from routers import prediction
from services import live_classifier
import logging
import sys

# Configure logging to ensure output in VS Code terminal
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s:     %(message)s",
    stream=sys.stdout,
    force=True
)
logger = logging.getLogger("uvicorn")
logger.setLevel(logging.INFO)

# 1. Initialize app
app = FastAPI(title="Cocotry Backend")

# 2. Add Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(prediction.router)

# 3. Include Routers
# Authentication routes (Login/Register)
app.include_router(auth.router, prefix="/auth", tags=["Auth"])

# Social/Community routes
app.include_router(posts.router, prefix="/posts", tags=["Posts"])

# Classification routes (This handles /classify/image)
app.include_router(classify.router, prefix="/classify", tags=["Classify"])

# NEW: Mounting the classify router under the /user prefix
# This specifically fixes the 404 for POST /user/save-scan
app.include_router(classify.router, prefix="/user", tags=["User Actions"])

# Include the AI chat router
app.include_router(ai_router, prefix="/ai", tags=["AI"])

# Include the analytics router
app.include_router(analytics_router, prefix="/analytics", tags=["Analytics"])

# Include the acoustic router
app.include_router(acoustic.router, prefix="/acoustic", tags=["Acoustic"])

# WasteProduct routes
app.include_router(wasteproduct.router, prefix="/wasteproduct", tags=["WasteProduct"])

# Notification routes
app.include_router(notifications_router, prefix="/notifications", tags=["Notifications"])

# News routes
app.include_router(news.router, prefix="/news", tags=["News"])

# 4. Cloudinary Configuration
cloudinary.config(
    cloud_name=settings.cloudinary_cloud_name,
    api_key=settings.cloudinary_api_key,
    api_secret=settings.cloudinary_api_secret,
    secure=True
)
@app.on_event("startup")
async def warmup_models():
    await asyncio.to_thread(live_classifier.warmup)
    
@app.get("/")
async def root():
    return {"message": "Cocotry API is running"}

@app.get("/posts/{post_id}")
async def get_single_post(post_id: str, db = Depends(get_db)):
    """
    Fetch a single post by ID
    """
    try:
        post = await get_single_post_logic(post_id, db)
        # Transform image_urls array to single image for frontend compatibility
        if post.get("image_urls") and len(post["image_urls"]) > 0:
            post["image"] = post["image_urls"][0]
        return post
    except Exception as e:
        return {"error": str(e)}, 400