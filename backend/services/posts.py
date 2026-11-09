import cloudinary.uploader
import datetime
from bson import ObjectId
from utils.content_filter import filter_content
from fastapi import HTTPException, status
from services.notifications import broadcast_notification

async def create_post_logic(files, title, description, user_id, db):
    """
    Handles multiple file uploads to Cloudinary and saves the post to MongoDB.
    Fetches full user data including profile image.
    """
    # Get user data
    try:
        user_oid = ObjectId(user_id)
    except:
        raise Exception("Invalid user ID")
    
    user = await db.users.find_one({"_id": user_oid})
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    
    # Filter content for bad words
    title_filter = filter_content(title)
    description_filter = filter_content(description)
    
    if title_filter['has_bad_words'] or description_filter['has_bad_words']:
        detected_words = list(set(title_filter['detected_words'] + description_filter['detected_words']))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Content contains inappropriate language: {', '.join(detected_words)}"
        )
    
    image_urls = []

    # Loop through the list of files and upload each one if provided
    if files:
        for file in files:
            if hasattr(file, "file") and getattr(file, "filename", None):
                upload_result = cloudinary.uploader.upload(file.file)
                secure_url = upload_result.get("secure_url")
                if secure_url:
                    image_urls.append(secure_url)
    
    # Structure the document with full author data
    new_post = {
        "title": title,
        "description": description,
        "image_urls": image_urls,
        "author": {
            "id": str(user["_id"]),
            "name": user.get("fullName", "Anonymous"),
            "email": user.get("email"),
            "profileImage": user.get("profileImage")
        },
        "timestamp": datetime.datetime.now()
    }
    
    # Save to MongoDB
    result = await db.posts.insert_one(new_post)

    # Notify everyone about the new post
    author_name = user.get("fullName", "Anonymous")
    await broadcast_notification(
        db,
        notif_type="new_post",
        title="New Community Post",
        message=f"{author_name} posted: {title}",
        data={"post_id": str(result.inserted_id), "author_id": user_id},
    )

    return {
        "status": "success", 
        "post_id": str(result.inserted_id),
        "image_count": len(image_urls),
        "image_urls": image_urls
    }

async def get_all_posts_logic(db):
    """
    Retrieves all posts with their array of image URLs.
    """
    cursor = db.posts.find().sort("timestamp", -1)
    posts_list = await cursor.to_list(length=100)
    for post in posts_list:
        post["_id"] = str(post["_id"])
    return posts_list

async def get_user_posts_logic(user_id: str, db):
    """
    Retrieves all posts created by a specific user.
    """
    try:
        user_oid = ObjectId(user_id)
    except:
        raise Exception("Invalid user ID")
    
    # Query posts where author.id matches the user_id
    cursor = db.posts.find({"author.id": user_id}).sort("timestamp", -1)
    posts_list = await cursor.to_list(length=100)
    
    for post in posts_list:
        post["_id"] = str(post["_id"])
    
    return posts_list

async def get_single_post_logic(post_id: str, db):
    """
    Retrieves a single post by ID with all its details.
    """
    try:
        post_oid = ObjectId(post_id)
    except:
        raise Exception("Invalid post ID")
    
    post = await db.posts.find_one({"_id": post_oid})
    
    if not post:
        raise Exception("Post not found")
    
    post["_id"] = str(post["_id"])
    return post