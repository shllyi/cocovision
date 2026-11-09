from fastapi import APIRouter, File, UploadFile, Form, Depends, Request, HTTPException, status, Header
from typing import Optional, List
from services import posts
from services.notifications import create_notification as _notif
from database import get_db
from bson import ObjectId
from datetime import datetime
from pydantic import BaseModel
from utils.content_filter import filter_content
from services.deps import current_user_id


class CommentCreate(BaseModel):
    text: str


class PostUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None


router = APIRouter()

@router.post("/create")
async def create_post(
    request: Request,
    files: Optional[List[UploadFile]] = File(None), 
    title: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    current_id: str = Depends(current_user_id),
    db = Depends(get_db)
):
    # Inspect form data for diagnostics
    form = await request.form()
    form_keys = list(form.keys())

    print("POST /posts/create - Content-Type:", request.headers.get("content-type"))
    print("POST /posts/create - Received form keys:", form_keys)

    # Validation logic
    missing = []
    if not title:
        missing.append("title")
    if not description:
        missing.append("description")

    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "message": "Missing required multipart form fields",
                "missing": missing,
                "received_form_keys": form_keys
            }
        )

    # Pass the list of files and user_id to service logic
    return await posts.create_post_logic(
        files, title, description, current_id, db
    )

@router.get("/all")
async def get_all_posts(db = Depends(get_db)):
    return await posts.get_all_posts_logic(db)

@router.get("/user")
async def get_user_posts(
    user_id: str = Depends(current_user_id),
    db = Depends(get_db)
):
    """Get all posts created by the authenticated user"""
    
    posts_list = await posts.get_user_posts_logic(user_id, db)
    return {
        "status": "success",
        "posts": posts_list,
        "count": len(posts_list)
    }


@router.put("/{post_id}")
async def update_post(
    post_id: str,
    post_data: PostUpdate,
    user_id: str = Depends(current_user_id),
    db=Depends(get_db)
):
    """Update a post (only by the author)"""
    try:
        post_oid = ObjectId(post_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid request")
    
    # Find the post
    post = await db.posts.find_one({"_id": post_oid})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Check ownership
    if post.get("author", {}).get("id") != user_id:
        raise HTTPException(status_code=403, detail="You can only edit your own posts")
    
    # Build update document
    update_fields = {}
    if post_data.title is not None:
        update_fields["title"] = post_data.title
    if post_data.description is not None:
        update_fields["description"] = post_data.description
    
    if update_fields:
        update_fields["updated_at"] = datetime.utcnow()
        await db.posts.update_one({"_id": post_oid}, {"$set": update_fields})
    
    return {"status": "success", "message": "Post updated successfully"}


@router.delete("/{post_id}")
async def delete_post(
    post_id: str,
    user_id: str = Depends(current_user_id),
    db=Depends(get_db)
):
    """Delete a post (only by the author)"""
    try:
        post_oid = ObjectId(post_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid request")
    
    # Find the post
    post = await db.posts.find_one({"_id": post_oid})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Check ownership
    if post.get("author", {}).get("id") != user_id:
        raise HTTPException(status_code=403, detail="You can only delete your own posts")
    
    await db.posts.delete_one({"_id": post_oid})
    
    return {"status": "success", "message": "Post deleted successfully"}


@router.post("/{post_id}/like")
async def toggle_like(
    post_id: str,
    authorization: Optional[str] = Header(None),
    db=Depends(get_db)
):
    """Toggle like on a post"""
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing authorization header")
    
    try:
        token_parts = authorization.split(" ")
        user_id = token_parts[1]
        post_oid = ObjectId(post_id)
    except:
        raise HTTPException(status_code=400, detail="Invalid request")
    
    # Find the post
    post = await db.posts.find_one({"_id": post_oid})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Get user info
    try:
        user = await db.users.find_one({"_id": ObjectId(user_id)})
        user_name = user.get("fullName", "Anonymous") if user else "Anonymous"
    except:
        user_name = "Anonymous"
    
    likes = post.get("likes", [])
    
    # Check if user already liked
    user_liked = any(like.get("user_id") == user_id for like in likes)
    
    if user_liked:
        # Remove like
        await db.posts.update_one(
            {"_id": post_oid},
            {"$pull": {"likes": {"user_id": user_id}}}
        )
        action = "unliked"
    else:
        # Add like
        like_doc = {
            "user_id": user_id,
            "user_name": user_name,
            "timestamp": datetime.utcnow()
        }
        await db.posts.update_one(
            {"_id": post_oid},
            {"$push": {"likes": like_doc}}
        )
        action = "liked"
        # Notify post author (skip if user liked their own post)
        post_author_id = post.get("author", {}).get("id")
        if post_author_id and post_author_id != user_id:
            await _notif(
                db,
                recipient_id=post_author_id,
                notif_type="like",
                title="Someone liked your post 👍",
                message=f"{user_name} liked your post \u201c{post.get('title', '')[:50]}\u201d",
                data={"post_id": post_id},
            )
    
    # Get updated like count
    updated_post = await db.posts.find_one({"_id": post_oid})
    like_count = len(updated_post.get("likes", []))
    
    return {
        "status": "success",
        "action": action,
        "like_count": like_count,
        "user_liked": action == "liked"
    }


@router.post("/{post_id}/comment")
async def add_comment(
    post_id: str,
    comment_data: CommentCreate,
    user_id: str = Depends(current_user_id),    
    db=Depends(get_db)
):
    """Add a comment to a post"""
    try:
        post_oid = ObjectId(post_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid request")
    
    # Find the post
    post = await db.posts.find_one({"_id": post_oid})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Filter comment content for bad words
    comment_filter = filter_content(comment_data.text)
    if comment_filter['has_bad_words']:
        raise HTTPException(
            status_code=400, 
            detail=f"Comment contains inappropriate language: {', '.join(comment_filter['detected_words'])}"
        )
    
    # Get user info
    try:
        user = await db.users.find_one({"_id": ObjectId(user_id)})
        user_name = user.get("fullName", "Anonymous") if user else "Anonymous"
        user_profile = user.get("profileImage") if user else None
    except:
        user_name = "Anonymous"
        user_profile = None
    
    comment_doc = {
        "id": str(ObjectId()),
        "user_id": user_id,
        "author": user_name,
        "profile_image": user_profile,
        "text": comment_data.text,
        "timestamp": datetime.utcnow()
    }
    
    await db.posts.update_one(
        {"_id": post_oid},
        {"$push": {"comments": comment_doc}}
    )
    
    # Notify post author (skip if user comments on their own post)
    post_author_id = post.get("author", {}).get("id")
    if post_author_id and post_author_id != user_id:
        await _notif(
            db,
            recipient_id=post_author_id,
            notif_type="comment",
            title="New comment on your post 💬",
            message=f"{user_name} commented: \u201c{comment_data.text[:60]}\u201d",
            data={"post_id": post_id},
        )

    # Get updated comment count
    updated_post = await db.posts.find_one({"_id": post_oid})
    comment_count = len(updated_post.get("comments", []))
    
    return {
        "status": "success",
        "comment": comment_doc,
        "comment_count": comment_count
    }


@router.delete("/{post_id}/comment/{comment_id}")
async def delete_comment(
    post_id: str,
    comment_id: str,
    user_id: str = Depends(current_user_id),
    db=Depends(get_db)
):
    """Delete a comment (only by the comment author)"""
    try:
        post_oid = ObjectId(post_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid request")
    
    # Find the post
    post = await db.posts.find_one({"_id": post_oid})
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    
    # Find the comment and verify ownership
    comments = post.get("comments", [])
    comment_to_delete = None
    for comment in comments:
        if comment.get("id") == comment_id:
            comment_to_delete = comment
            break
    
    if not comment_to_delete:
        raise HTTPException(status_code=404, detail="Comment not found")
    
    if comment_to_delete.get("user_id") != user_id:
        raise HTTPException(status_code=403, detail="You can only delete your own comments")
    
    await db.posts.update_one(
        {"_id": post_oid},
        {"$pull": {"comments": {"id": comment_id}}}
    )
    
    return {"status": "success", "message": "Comment deleted successfully"}
