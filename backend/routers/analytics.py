import asyncio
from fastapi.responses import Response
from services import analytics_export
from fastapi import APIRouter, Depends, Header, HTTPException
from typing import Optional
from database import get_db
from bson import ObjectId
from datetime import datetime, timedelta
from collections import defaultdict, Counter
from services.deps import require_admin, current_user_id

router = APIRouter()


@router.get("/admin/stats")
async def get_admin_stats(
    admin: dict = Depends(require_admin),
    db=Depends(get_db)
):
    """Get comprehensive admin analytics for the dashboard"""

    # Get current date and calculate date ranges
    
    # Get current date and calculate date ranges
    now = datetime.utcnow()
    last_7_days = now - timedelta(days=7)
    last_30_days = now - timedelta(days=30)
    
    # Total counts
    total_users = await db.users.count_documents({})
    total_posts = await db.posts.count_documents({})
    total_scans = await db.scans.count_documents({})
    total_comments = await db.posts.aggregate([
        {"$project": {"comment_count": {"$size": {"$ifNull": ["$comments", []]}}}},
        {"$group": {"_id": None, "total": {"$sum": "$comment_count"}}}
    ]).to_list(1)
    total_comments_count = total_comments[0]["total"] if total_comments else 0
    
    # Get users registered per day (last 30 days)
    users_per_day = await db.users.aggregate([
        {"$match": {"created_at": {"$gte": last_30_days}}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}},
            "count": {"$sum": 1}
        }},
        {"$sort": {"_id": 1}}
    ]).to_list(30)
    
    # Get posts per day (last 30 days)
    posts_per_day = await db.posts.aggregate([
        {"$match": {"timestamp": {"$gte": last_30_days}}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$timestamp"}},
            "count": {"$sum": 1}
        }},
        {"$sort": {"_id": 1}}
    ]).to_list(30)
    
    # Get scans per day (last 30 days)
    scans_per_day = await db.scans.aggregate([
        {"$match": {"timestamp": {"$gte": last_30_days}}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$timestamp"}},
            "count": {"$sum": 1}
        }},
        {"$sort": {"_id": 1}}
    ]).to_list(30)
    
    # Stage distribution from all scans - separate by model (with avg confidence)
    # Original model distribution with confidence
    original_model_stages = await db.scans.aggregate([
        {"$unwind": "$detections"},
        {"$match": {"detections.original_model.primary.label": {"$ne": None}}},
        {"$group": {
            "_id": "$detections.original_model.primary.label",
            "count": {"$sum": 1},
            "avg_confidence": {"$avg": "$detections.original_model.primary.confidence"}
        }}
    ]).to_list(10)
    
    # Custom model distribution with confidence
    custom_model_stages = await db.scans.aggregate([
        {"$unwind": "$detections"},
        {"$match": {"detections.custom_model.primary.label": {"$ne": None}}},
        {"$group": {
            "_id": "$detections.custom_model.primary.label",
            "count": {"$sum": 1},
            "avg_confidence": {"$avg": "$detections.custom_model.primary.confidence"}
        }}
    ]).to_list(10)
    
    # Fallback: flat structure (legacy scans without nested models)
    flat_stage_distribution = await db.scans.aggregate([
        {"$unwind": "$detections"},
        {"$match": {"detections.label": {"$ne": None}, "detections.original_model": {"$exists": False}}},
        {"$group": {
            "_id": "$detections.label",
            "count": {"$sum": 1},
            "avg_confidence": {"$avg": "$detections.confidence"}
        }}
    ]).to_list(10)
    
    # Combine original model stages (count + confidence)
    original_stages = {}
    original_confidences = {}
    original_conf_counts = {}
    for item in original_model_stages:
        if item["_id"]:
            label = item["_id"]
            original_stages[label] = original_stages.get(label, 0) + item["count"]
            if item.get("avg_confidence") is not None:
                original_confidences[label] = original_confidences.get(label, 0) + item["avg_confidence"] * item["count"]
                original_conf_counts[label] = original_conf_counts.get(label, 0) + item["count"]
    for item in flat_stage_distribution:
        if item["_id"]:
            label = item["_id"]
            original_stages[label] = original_stages.get(label, 0) + item["count"]
            if item.get("avg_confidence") is not None:
                original_confidences[label] = original_confidences.get(label, 0) + item["avg_confidence"] * item["count"]
                original_conf_counts[label] = original_conf_counts.get(label, 0) + item["count"]
    
    # Custom model stages (count + confidence)
    custom_stages = {}
    custom_confidences = {}
    custom_conf_counts = {}
    for item in custom_model_stages:
        if item["_id"]:
            label = item["_id"]
            custom_stages[label] = custom_stages.get(label, 0) + item["count"]
            if item.get("avg_confidence") is not None:
                custom_confidences[label] = custom_confidences.get(label, 0) + item["avg_confidence"] * item["count"]
                custom_conf_counts[label] = custom_conf_counts.get(label, 0) + item["count"]
    
    # Compute weighted average confidence per stage
    original_stage_confidence = {}
    for label in original_confidences:
        if original_conf_counts.get(label, 0) > 0:
            original_stage_confidence[label] = original_confidences[label] / original_conf_counts[label]
    
    custom_stage_confidence = {}
    for label in custom_confidences:
        if custom_conf_counts.get(label, 0) > 0:
            custom_stage_confidence[label] = custom_confidences[label] / custom_conf_counts[label]
    
    # Overall model-level avg confidence
    original_overall_confidence = 0
    if original_conf_counts:
        total_weighted = sum(original_confidences.values())
        total_count = sum(original_conf_counts.values())
        original_overall_confidence = (total_weighted / total_count) if total_count > 0 else 0
    
    custom_overall_confidence = 0
    if custom_conf_counts:
        total_weighted = sum(custom_confidences.values())
        total_count = sum(custom_conf_counts.values())
        custom_overall_confidence = (total_weighted / total_count) if total_count > 0 else 0
    
    # Per-model success rate (scans that had at least one detection for each model)
    original_success_scans = await db.scans.count_documents({"detections.original_model": {"$exists": True}})
    custom_success_scans = await db.scans.count_documents({"detections.custom_model": {"$exists": True}})
    original_success_rate = (original_success_scans / max(total_scans, 1)) * 100
    custom_success_rate = (custom_success_scans / max(total_scans, 1)) * 100
    
    # Per-model average inference time
    original_inference = await db.scans.aggregate([
        {"$match": {"detections.original_model": {"$exists": True}, "inference_time": {"$exists": True}}},
        {"$group": {"_id": None, "avg_time": {"$avg": "$inference_time"}}}
    ]).to_list(1)
    custom_inference = await db.scans.aggregate([
        {"$match": {"detections.custom_model": {"$exists": True}, "inference_time": {"$exists": True}}},
        {"$group": {"_id": None, "avg_time": {"$avg": "$inference_time"}}}
    ]).to_list(1)
    original_avg_inference = original_inference[0]["avg_time"] if original_inference else 0
    custom_avg_inference = custom_inference[0]["avg_time"] if custom_inference else 0
    
    # Total coconuts detected
    total_coconuts = await db.scans.aggregate([
        {"$group": {"_id": None, "total": {"$sum": "$total_count"}}}
    ]).to_list(1)
    total_coconuts_count = total_coconuts[0]["total"] if total_coconuts else 0
    
    # Total likes received across all posts
    total_likes = await db.posts.aggregate([
        {"$project": {"like_count": {"$size": {"$ifNull": ["$likes", []]}}}},
        {"$group": {"_id": None, "total": {"$sum": "$like_count"}}}
    ]).to_list(1)
    total_likes_count = total_likes[0]["total"] if total_likes else 0
    
    # Top users by posts
    top_posters = await db.posts.aggregate([
        {"$group": {
            "_id": "$author.id",
            "name": {"$first": "$author.name"},
            "profileImage": {"$first": "$author.profileImage"},
            "post_count": {"$sum": 1}
        }},
        {"$sort": {"post_count": -1}},
        {"$limit": 5}
    ]).to_list(5)
    
    # Top users by scans
    top_scanners = await db.scans.aggregate([
        {"$group": {
            "_id": "$user_id",
            "scan_count": {"$sum": 1},
            "total_detected": {"$sum": "$total_count"}
        }},
        {"$sort": {"scan_count": -1}},
        {"$limit": 5}
    ]).to_list(5)
    
    # Enrich top scanners with user info
    for scanner in top_scanners:
        try:
            user = await db.users.find_one({"_id": scanner["_id"]})
            if user:
                scanner["name"] = user.get("fullName", "Unknown")
                scanner["profileImage"] = user.get("profileImage")
        except:
            scanner["name"] = "Unknown"
        scanner["_id"] = str(scanner["_id"])
    
    # Recent activity (last 10 actions)
    recent_posts = await db.posts.find().sort("timestamp", -1).limit(5).to_list(5)
    recent_scans = await db.scans.find().sort("timestamp", -1).limit(5).to_list(5)
    
    # Format recent activity
    recent_activity = []
    for post in recent_posts:
        recent_activity.append({
            "type": "post",
            "title": post.get("title", "Untitled"),
            "author": post.get("author", {}).get("name", "Unknown"),
            "timestamp": post.get("timestamp").isoformat() if post.get("timestamp") else None
        })
    for scan in recent_scans:
        user = await db.users.find_one({"_id": scan.get("user_id")})
        recent_activity.append({
            "type": "scan",
            "title": f"Detected {scan.get('total_count', 0)} coconuts",
            "author": user.get("fullName", "Unknown") if user else "Unknown",
            "timestamp": scan.get("timestamp").isoformat() if scan.get("timestamp") else None
        })
    
    # Sort by timestamp
    recent_activity.sort(key=lambda x: x.get("timestamp") or "", reverse=True)
    
    # Weekly growth calculation
    week_ago_users = await db.users.count_documents({"created_at": {"$lt": last_7_days}})
    week_ago_posts = await db.posts.count_documents({"timestamp": {"$lt": last_7_days}})
    week_ago_scans = await db.scans.count_documents({"timestamp": {"$lt": last_7_days}})
    
    user_growth = ((total_users - week_ago_users) / max(week_ago_users, 1)) * 100
    post_growth = ((total_posts - week_ago_posts) / max(week_ago_posts, 1)) * 100
    scan_growth = ((total_scans - week_ago_scans) / max(week_ago_scans, 1)) * 100
    
    # ============ NEW ANALYTICS ============
    
    # Community & Social - Posts per Category
    posts_by_category = await db.posts.aggregate([
        {"$group": {
            "_id": "$category",
            "count": {"$sum": 1}
        }}
    ]).to_list(10)
    
    # Community Engagement Rate (likes + comments / posts)
    engagement_rate = ((total_likes_count + total_comments_count) / max(total_posts, 1)) * 100
    
    # Top Trending Topics (extract hashtags/keywords from post titles)
    all_posts = await db.posts.find({}, {"title": 1, "content": 1}).limit(1000).to_list(1000)
    words = []
    for post in all_posts:
        title_words = str(post.get("title", "")).lower().split()
        content_words = str(post.get("content", "")).lower().split()
        words.extend([w for w in title_words + content_words if len(w) > 3])
    word_freq = Counter(words).most_common(20)
    
    # Reported/Flagged Content
    flagged_posts = await db.posts.count_documents({"reported": True})
    
    # AI Vision - Average Confidence Score
    all_scans = await db.scans.find({}).to_list(None)
    confidence_scores = []
    scan_success = 0
    scan_failure = 0
    no_detection = 0
    inference_times = []
    
    for scan in all_scans:
        detections = scan.get("detections", [])
        if len(detections) == 0:
            no_detection += 1
            scan_failure += 1
        else:
            scan_success += 1
            for det in detections:
                # Check nested structure
                if det.get("original_model"):
                    conf = det.get("original_model", {}).get("primary", {}).get("confidence")
                    if conf:
                        confidence_scores.append(conf)
                if det.get("custom_model"):
                    conf = det.get("custom_model", {}).get("primary", {}).get("confidence")
                    if conf:
                        confidence_scores.append(conf)
                # Check flat structure
                if det.get("confidence") and not det.get("original_model"):
                    confidence_scores.append(det.get("confidence"))
        
        # Inference latency
        if scan.get("inference_time"):
            inference_times.append(scan.get("inference_time"))
    
    avg_confidence = sum(confidence_scores) / len(confidence_scores) if confidence_scores else 0
    avg_inference_time = sum(inference_times) / len(inference_times) if inference_times else 0
    no_detection_rate = (no_detection / max(total_scans, 1)) * 100
    success_rate = (scan_success / max(total_scans, 1)) * 100
    failure_rate = (scan_failure / max(total_scans, 1)) * 100
    
    # Hourly Scan Activity
    scans_by_hour = await db.scans.aggregate([
        {"$project": {
            "hour": {"$hour": "$timestamp"}
        }},
        {"$group": {
            "_id": "$hour",
            "count": {"$sum": 1}
        }},
        {"$sort": {"_id": 1}}
    ]).to_list(24)
    
    # User & Growth - New Signups Last 7 Days
    new_signups_7d = await db.users.count_documents({"created_at": {"$gte": last_7_days}})
    
    # Daily Active Users (users who posted or scanned in last 24 hours)
    yesterday = now - timedelta(days=1)
    active_posters = await db.posts.distinct("author.id", {"timestamp": {"$gte": yesterday}})
    active_scanners = await db.scans.distinct("user_id", {"timestamp": {"$gte": yesterday}})
    dau = len(set(active_posters) | set([str(uid) for uid in active_scanners]))
    
    # User Retention Rate (users active in last 7 days / total users)
    active_users_7d_posts = await db.posts.distinct("author.id", {"timestamp": {"$gte": last_7_days}})
    active_users_7d_scans = await db.scans.distinct("user_id", {"timestamp": {"$gte": last_7_days}})
    active_users_7d = len(set(active_users_7d_posts) | set([str(uid) for uid in active_users_7d_scans]))
    retention_rate = (active_users_7d / max(total_users, 1)) * 100
    
    # Market & Economy - Copra Prices
    copra_prices = await db.prices.find({"commodity": "copra"}).sort("date", -1).limit(30).to_list(30)
    copra_prices.reverse()  # Oldest to newest
    
    # Current Millgate Price
    millgate_price = await db.prices.find_one({"commodity": "millgate"}, sort=[("date", -1)])
    
    # Price Volatility (standard deviation of copra prices)
    if copra_prices:
        prices_list = [p.get("price", 0) for p in copra_prices]
        avg_price = sum(prices_list) / len(prices_list)
        variance = sum((p - avg_price) ** 2 for p in prices_list) / len(prices_list)
        volatility = variance ** 0.5
    else:
        volatility = 0
        avg_price = 0
    
    # Most Viewed Commodity (if tracking views)
    commodity_views = await db.prices.aggregate([
        {"$group": {
            "_id": "$commodity",
            "views": {"$sum": {"$ifNull": ["$views", 1]}}
        }},
        {"$sort": {"views": -1}},
        {"$limit": 1}
    ]).to_list(1)
    most_viewed_commodity = commodity_views[0]["_id"] if commodity_views else "copra"
    
    # Regional Price Comparison (if location field exists)
    regional_prices = await db.prices.aggregate([
        {"$match": {"commodity": "copra", "date": {"$gte": last_7_days}}},
        {"$group": {
            "_id": "$region",
            "avg_price": {"$avg": "$price"}
        }}
    ]).to_list(20)
    
    # System Health - Database Stats
    db_stats = {
        "total_collections": 0,
        "total_documents": total_users + total_posts + total_scans,
        "storage_size": 0
    }
    
    return {
        "status": "success",
        "summary": {
            "total_users": total_users,
            "total_posts": total_posts,
            "total_scans": total_scans,
            "total_comments": total_comments_count,
            "total_coconuts": total_coconuts_count,
            "total_likes": total_likes_count,
            "user_growth": round(user_growth, 1),
            "post_growth": round(post_growth, 1),
            "scan_growth": round(scan_growth, 1),
            # New metrics
            "avg_confidence": round(avg_confidence * 100, 1) if avg_confidence else 0,
            "avg_inference_time": round(avg_inference_time, 2),
            "no_detection_rate": round(no_detection_rate, 1),
            "scan_success_rate": round(success_rate, 1),
            "scan_failure_rate": round(failure_rate, 1),
            "engagement_rate": round(engagement_rate, 1),
            "flagged_posts": flagged_posts,
            "new_signups_7d": new_signups_7d,
            "dau": dau,
            "retention_rate": round(retention_rate, 1),
            "price_volatility": round(volatility, 2),
            "most_viewed_commodity": most_viewed_commodity
        },
        "charts": {
            "users_per_day": [{"date": d["_id"], "count": d["count"]} for d in users_per_day],
            "posts_per_day": [{"date": d["_id"], "count": d["count"]} for d in posts_per_day],
            "scans_per_day": [{"date": d["_id"], "count": d["count"]} for d in scans_per_day],
            "original_model_distribution": [
                {"stage": k, "count": v, "confidence": round(original_stage_confidence.get(k, 0) * 100, 1)} 
                for k, v in original_stages.items()
            ],
            "custom_model_distribution": [
                {"stage": k, "count": v, "confidence": round(custom_stage_confidence.get(k, 0) * 100, 1)} 
                for k, v in custom_stages.items()
            ],
            "stage_distribution": [
                {"stage": k, "count": v, "confidence": round(original_stage_confidence.get(k, 0) * 100, 1)} 
                for k, v in original_stages.items()
            ],
            # New charts
            "posts_by_category": [{"category": d["_id"] or "uncategorized", "count": d["count"]} for d in posts_by_category],
            "trending_topics": [{"word": word, "count": count} for word, count in word_freq[:10]],
            "scans_by_hour": [{"hour": d["_id"], "count": d["count"]} for d in scans_by_hour],
            "copra_prices": [{"date": p.get("date").isoformat() if p.get("date") else "", "price": p.get("price", 0)} for p in copra_prices],
            "regional_prices": [{"region": d["_id"] or "unknown", "avg_price": round(d["avg_price"], 2)} for d in regional_prices]
        },
        "market": {
            "current_millgate_price": millgate_price.get("price") if millgate_price else None,
            "millgate_date": millgate_price.get("date").isoformat() if millgate_price and millgate_price.get("date") else None
        },
        "system": {
            "database": db_stats
        },
        "leaderboards": {
            "top_posters": top_posters,
            "top_scanners": top_scanners
        },
        "recent_activity": recent_activity[:10],
        "model_comparison": {
            "original": {
                "avg_confidence": round(original_overall_confidence * 100, 1),
                "success_rate": round(original_success_rate, 1),
                "avg_inference_time": round(original_avg_inference, 2) if original_avg_inference else 0,
                "total_scans": sum(original_stages.values()) if original_stages else 0,
                "per_type_confidence": {k: round(v * 100, 1) for k, v in original_stage_confidence.items()}
            },
            "custom": {
                "avg_confidence": round(custom_overall_confidence * 100, 1),
                "success_rate": round(custom_success_rate, 1),
                "avg_inference_time": round(custom_avg_inference, 2) if custom_avg_inference else 0,
                "total_scans": sum(custom_stages.values()) if custom_stages else 0,
                "per_type_confidence": {k: round(v * 100, 1) for k, v in custom_stage_confidence.items()}
            }
        }
    }


@router.get("/user/stats")
async def get_user_stats(
    user_id: str = Depends(current_user_id),
    db=Depends(get_db)
):
    """Get personal analytics for a user's dashboard"""

    user_oid = ObjectId(user_id)
    
    # Verify user exists
    user = await db.users.find_one({"_id": user_oid})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    now = datetime.utcnow()
    last_30_days = now - timedelta(days=30)
    last_7_days = now - timedelta(days=7)
    
    # User's total stats
    total_posts = await db.posts.count_documents({"author.id": user_id})
    total_scans = await db.scans.count_documents({"user_id": user_oid})
    
    # Total likes received on user's posts
    user_posts = await db.posts.find({"author.id": user_id}).to_list(None)
    total_likes = sum(len(post.get("likes", [])) for post in user_posts)
    total_comments = sum(len(post.get("comments", [])) for post in user_posts)
    
    # Total coconuts detected by user
    user_scans = await db.scans.find({"user_id": user_oid}).to_list(None)
    total_coconuts_detected = sum(scan.get("total_count", 0) for scan in user_scans)
    
    # Scans per day (last 30 days)
    scans_per_day = await db.scans.aggregate([
        {"$match": {"user_id": user_oid, "timestamp": {"$gte": last_30_days}}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$timestamp"}},
            "count": {"$sum": 1}
        }},
        {"$sort": {"_id": 1}}
    ]).to_list(30)
    
    # Posts per day (last 30 days)
    posts_per_day = await db.posts.aggregate([
        {"$match": {"author.id": user_id, "timestamp": {"$gte": last_30_days}}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$timestamp"}},
            "count": {"$sum": 1}
        }},
        {"$sort": {"_id": 1}}
    ]).to_list(30)
    
    # User's stage distribution from their scans - separate by model
    original_model_distribution = {}
    custom_model_distribution = {}
    
    for scan in user_scans:
        for det in scan.get("detections", []):
            # Handle nested structures (original_model/custom_model)
            if det.get("original_model"):
                orig_label = det.get("original_model", {}).get("primary", {}).get("label")
                if orig_label:
                    original_model_distribution[orig_label] = original_model_distribution.get(orig_label, 0) + 1
            if det.get("custom_model"):
                custom_label = det.get("custom_model", {}).get("primary", {}).get("label")
                if custom_label:
                    custom_model_distribution[custom_label] = custom_model_distribution.get(custom_label, 0) + 1
            # Handle flat structure (legacy)
            if det.get("label") and not det.get("original_model"):
                label = det.get("label")
                original_model_distribution[label] = original_model_distribution.get(label, 0) + 1
    
    # Coconuts detected per day
    coconuts_per_day = await db.scans.aggregate([
        {"$match": {"user_id": user_oid, "timestamp": {"$gte": last_30_days}}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$timestamp"}},
            "count": {"$sum": "$total_count"}
        }},
        {"$sort": {"_id": 1}}
    ]).to_list(30)
    
    # Weekly comparison
    scans_this_week = await db.scans.count_documents({
        "user_id": user_oid,
        "timestamp": {"$gte": last_7_days}
    })
    scans_prev_week = await db.scans.count_documents({
        "user_id": user_oid,
        "timestamp": {"$gte": last_7_days - timedelta(days=7), "$lt": last_7_days}
    })
    
    scan_change = scans_this_week - scans_prev_week
    
    # Most recent scans
    recent_scans = await db.scans.find({"user_id": user_oid}).sort("timestamp", -1).limit(5).to_list(5)
    for scan in recent_scans:
        scan["_id"] = str(scan["_id"])
        scan["user_id"] = str(scan["user_id"])
    
    # Most liked posts
    top_posts = sorted(user_posts, key=lambda p: len(p.get("likes", [])), reverse=True)[:5]
    for post in top_posts:
        post["_id"] = str(post["_id"])
        post["like_count"] = len(post.get("likes", []))
        post["comment_count"] = len(post.get("comments", []))
    
    return {
        "status": "success",
        "summary": {
            "total_posts": total_posts,
            "total_scans": total_scans,
            "total_likes": total_likes,
            "total_comments": total_comments,
            "total_coconuts_detected": total_coconuts_detected,
            "scan_change_this_week": scan_change
        },
        "charts": {
            "scans_per_day": [{"date": d["_id"], "count": d["count"]} for d in scans_per_day],
            "posts_per_day": [{"date": d["_id"], "count": d["count"]} for d in posts_per_day],
            "coconuts_per_day": [{"date": d["_id"], "count": d["count"]} for d in coconuts_per_day],
            "original_model_distribution": [{"stage": k, "count": v} for k, v in original_model_distribution.items()],
            "custom_model_distribution": [{"stage": k, "count": v} for k, v in custom_model_distribution.items()],
            "stage_distribution": [{"stage": k, "count": v} for k, v in original_model_distribution.items()]
        },
        "top_posts": top_posts,
        "recent_scans": recent_scans
    }
@router.get("/admin/export")
async def export_admin_stats(
    format: str = "pdf",
    admin: dict = Depends(require_admin),
    db=Depends(get_db),
):
    fmt = format.lower()
    if fmt not in analytics_export.BUILDERS:
        raise HTTPException(status_code=400, detail="format must be pdf, xlsx, docx or csv")
    data = await get_admin_stats(admin=admin, db=db)  # also checks admin role
    body, mime, ext = await asyncio.to_thread(analytics_export.BUILDERS[fmt], data)
    filename = f"cocovision-analytics-{datetime.utcnow():%Y-%m-%d}.{ext}"
    return Response(
        content=body,
        media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )