import firebase_admin
from firebase_admin import credentials, auth
from fastapi import HTTPException, UploadFile
from schemas.auth import UserRegister, UserLogin
from bson import ObjectId
from typing import Optional
import cloudinary
import cloudinary.uploader
from datetime import datetime
from services.notifications import create_notification as _notif
import hmac
from services.security import hash_password, verify_password, is_hashed, create_token

# --- 1. INITIALIZE FIREBASE ADMIN ---
# This ensures we can verify tokens sent from the frontend.
# ⚠️ UPDATE THE PATH to your actual serviceAccountKey.json file
try:
    if not firebase_admin._apps:
        cred = credentials.Certificate("serviceAccountKey.json") 
        firebase_admin.initialize_app(cred)
except Exception as e:
    print(f"⚠️ Warning: Firebase Admin not initialized: {e}")


# --- 2. STANDARD REGISTRATION LOGIC ---
async def register_user_logic(user_data: UserRegister, db):
    # Check if email exists
    existing_user = await db.users.find_one({"email": user_data.email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    if user_data.password != user_data.confirmPassword:
        raise HTTPException(status_code=400, detail="Passwords do not match")

    # Convert to dict and force role to "user" for safety
    user_dict = user_data.dict()
    user_dict["role"] = "user" 
    user_dict["created_at"] = datetime.utcnow()
    user_dict["auth_provider"] = "email" # Mark as standard email user
    
    # Remove confirmPassword before saving
    del user_dict["confirmPassword"]
    user_dict["password"] = hash_password(user_dict["password"])
    
    result = await db.users.insert_one(user_dict)
    
    return {
        "status": "success", 
        "message": "User registered successfully. Please log in.",
        "user_id": str(result.inserted_id)
    }


# --- 3. STANDARD LOGIN LOGIC ---
async def login_user_logic(login_data: UserLogin, db):
    # Find the user by email
    user = await db.users.find_one({"email": login_data.email})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    stored = user.get("password")
    if not stored:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if is_hashed(stored):
        ok = verify_password(login_data.password, stored)
    else:
        # legacy plaintext: accept once, then upgrade to a hash
        ok = hmac.compare_digest(stored.encode(), login_data.password.encode())
        if ok:
            await db.users.update_one(
                {"_id": user["_id"]},
                {"$set": {"password": hash_password(login_data.password)}},
            )
    if not ok:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    # Check if the account is deactivated
    if user.get("is_active") is False:
        reason = user.get("deactivation_reason", "No reason provided")
        raise HTTPException(
            status_code=403,
            detail=f"Your account has been deactivated. Reason: {reason}"
        )

    # Prepare the user data to send back
    user_id_str = str(user["_id"])

    # Notify the user about the new login
    await _notif(
        db,
        recipient_id=user_id_str,
        notif_type="login_device",
        title="\u26a0\ufe0f New Login Detected",
        message=f"A new login was detected on your account ({user.get('email')}). If this wasn't you, please contact support.",
        data={"email": user.get("email")},
    )

    return {
        "status": "success",
        "user": {
            "token": create_token(user_id_str, user.get("role", "user")),
            "id": user_id_str,
            "fullName": user.get("fullName"),
            "email": user["email"],
            "role": user.get("role", "user"),
            "location": user.get("location"),
            "phoneNumber": user.get("phoneNumber"),
            "profileImage": user.get("profileImage")
        }

    }


# --- 4. GOOGLE SIGN-IN LOGIC (FIXED) ---
async def google_login_logic(token: str, db):
    try:
        # ✅ FIX: Added clock_skew_seconds=10 to prevent "Token used too early" error
        decoded_token = auth.verify_id_token(token, clock_skew_seconds=10)
        
        # Extract user info
        email = decoded_token.get('email')
        uid = decoded_token.get('uid')
        name = decoded_token.get('name', '')
        picture = decoded_token.get('picture', '')

        if not email:
            raise HTTPException(status_code=400, detail="Invalid Google Token: No email found")

        # Check if user exists in YOUR database
        user = await db.users.find_one({"email": email})

        # If found and deactivated, block login immediately
        if user and user.get("is_active") is False:
            reason = user.get("deactivation_reason", "No reason provided")
            raise HTTPException(
                status_code=403,
                detail=f"Your account has been deactivated. Reason: {reason}"
            )

        # --- SCENARIO A: NEW USER (AUTO-REGISTER) ---
        if not user:
            new_user = {
                "email": email,
                "fullName": name,
                "profileImage": picture,
                "role": "user",
                "firebase_uid": uid,  # Link to Firebase
                "auth_provider": "google",
                "created_at": datetime.utcnow(),
                "password": None, # Google users don't have a DB password
                "phoneNumber": "",
                "location": ""
            }
            result = await db.users.insert_one(new_user)
            user = await db.users.find_one({"_id": result.inserted_id})
        
        # --- SCENARIO B: EXISTING USER (SYNC) ---
        else:
            # Update their Firebase UID if it's missing or image if empty
            update_fields = {}
            if "firebase_uid" not in user:
                update_fields["firebase_uid"] = uid
            if not user.get("profileImage") and picture:
                update_fields["profileImage"] = picture
                
            if update_fields:
                await db.users.update_one(
                    {"_id": user["_id"]},
                    {"$set": update_fields}
                )
                # Refetch to get latest data
                user = await db.users.find_one({"_id": user["_id"]})

        # Return success (Same structure as standard login)
        user_id_str = str(user["_id"])

        # Notify the user about the login (Google)
        await _notif(
            db,
            recipient_id=user_id_str,
            notif_type="login_device",
            title="\u26a0\ufe0f New Login Detected",
            message=f"A Google sign-in was detected on your account ({user.get('email')}). If this wasn't you, please contact support.",
            data={"email": user.get("email"), "provider": "google"},
        )

        return {
            "status": "success",
            "user": {
                "token": create_token(user_id_str, user.get("role", "user")),
                "id": user_id_str,
                "fullName": user.get("fullName"),
                "email": user["email"],
                "role": user.get("role", "user"),
                "location": user.get("location"),
                "phoneNumber": user.get("phoneNumber"),
                "profileImage": user.get("profileImage")
            }
        }

    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid Firebase Token")
    except Exception as e:
        print(f"Google Login Error: {str(e)}")
        # If it's the token error specifically, give a clearer message
        if "Token used too early" in str(e):
             raise HTTPException(status_code=401, detail="Server time sync error. Please try again.")
        raise HTTPException(status_code=500, detail="Authentication failed")


# --- 5. GET ALL USERS LOGIC (ADMIN) ---
async def get_all_users_logic(db):
    cursor = db.users.find({}, {
        "password": 0  # exclude passwords
    }).sort("created_at", -1)
    users = await cursor.to_list(length=1000)
    result = []
    for u in users:
        result.append({
            "id": str(u["_id"]),
            "fullName": u.get("fullName", ""),
            "email": u.get("email", ""),
            "role": u.get("role", "user"),
            "location": u.get("location", ""),
            "phoneNumber": u.get("phoneNumber", ""),
            "profileImage": u.get("profileImage"),
            "auth_provider": u.get("auth_provider", "email"),
            "is_active": u.get("is_active", True),
            "deactivation_reason": u.get("deactivation_reason"),
            "created_at": u["created_at"].isoformat() if u.get("created_at") else None,
        })
    return result


# --- 6. UPDATE USER ROLE LOGIC (ADMIN) ---
async def update_user_role_logic(target_user_id: str, new_role: str, db):
    if new_role not in ("user", "admin"):
        raise HTTPException(status_code=400, detail="Invalid role. Must be 'user' or 'admin'")
    try:
        user_oid = ObjectId(target_user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID")

    result = await db.users.update_one(
        {"_id": user_oid},
        {"$set": {"role": new_role}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")

    # Notify the affected user about their role change
    role_label = "Admin" if new_role == "admin" else "User"
    await _notif(
        db,
        recipient_id=target_user_id,
        notif_type="role_change",
        title="\U0001F6E1\uFE0F Your Account Role Changed",
        message=f"Your account role has been updated to \u201c{role_label}\u201d by an administrator.",
        data={"new_role": new_role},
    )

    return {"status": "success", "message": f"User role updated to '{new_role}'"}


# --- 7. TOGGLE USER STATUS LOGIC (ADMIN) ---
async def toggle_user_status_logic(target_user_id: str, is_active: bool, reason: Optional[str], db):
    try:
        user_oid = ObjectId(target_user_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID")

    update_data: dict = {"is_active": is_active}
    if not is_active:
        update_data["deactivation_reason"] = reason or "Account deactivated by admin"
    else:
        # Clear the reason when reactivating
        update_data["deactivation_reason"] = None

    result = await db.users.update_one(
        {"_id": user_oid},
        {"$set": update_data}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="User not found")
    action = "activated" if is_active else "deactivated"
    return {"status": "success", "message": f"User {action} successfully"}


# --- 8. UPDATE USER PROFILE LOGIC ---
async def update_user_logic(
    user_id: str,
    fullName: str,
    email: str,
    phoneNumber: str,
    location: str,
    profileImage: Optional[UploadFile],
    db
):
    try:
        user_oid = ObjectId(user_id)
    except:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    
    user = await db.users.find_one({"_id": user_oid})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Prepare update data
    update_data = {
        "fullName": fullName,
        "phoneNumber": phoneNumber,
        "location": location
    }
    
    # Handle profile image upload if provided
    if profileImage:
        try:
            # Read the image file
            file_content = await profileImage.read()
            
            # Upload to Cloudinary
            cloudinary_response = cloudinary.uploader.upload(
                file_content,
                resource_type="auto",
                folder="cocotry/profiles",
                public_id=f"profile_{user_id}"
            )
            
            update_data["profileImage"] = cloudinary_response["secure_url"]
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to upload profile image: {str(e)}")
    
    # Update the user in database
    result = await db.users.update_one(
        {"_id": user_oid},
        {"$set": update_data}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=400, detail="Failed to update user")
    
    # Fetch updated user
    updated_user = await db.users.find_one({"_id": user_oid})

    # Notify the user that their profile was updated
    await _notif(
        db,
        recipient_id=user_id,
        notif_type="profile_update",
        title="\u2705 Profile Updated Successfully",
        message="Your profile information has been updated. If you did not make this change, please contact support.",
        data={},
    )

    return {
        "status": "success",
        "message": "Profile updated successfully",
        "id": str(updated_user["_id"]),
        "fullName": updated_user.get("fullName"),
        "email": updated_user["email"],
        "role": updated_user.get("role", "user"),
        "location": updated_user.get("location"),
        "phoneNumber": updated_user.get("phoneNumber"),
        "profileImage": updated_user.get("profileImage")
    }