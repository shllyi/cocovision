from fastapi import APIRouter, Depends, File, UploadFile, Form, HTTPException, Body
from schemas.auth import UserRegister, UserLogin, GoogleLoginRequest
from services import auth
from database import get_db
from typing import Optional
from services.deps import get_current_user, require_admin

router = APIRouter()

# --- 1. STANDARD REGISTER ---
@router.post("/register")
async def register(user_data: UserRegister, db = Depends(get_db)):
    return await auth.register_user_logic(user_data, db)

# --- 2. STANDARD LOGIN ---
@router.post("/login")
async def login(login_data: UserLogin, db = Depends(get_db)):
    return await auth.login_user_logic(login_data, db)

# --- 3. GOOGLE LOGIN (NEW) ---
@router.post("/google-login")
async def google_login(request: GoogleLoginRequest, db = Depends(get_db)):
    """
    Receives Firebase ID Token from frontend.
    Verifies it, and logs in (or auto-registers) the user.
    """
    return await auth.google_login_logic(request.token, db)

# --- 4. UPDATE PROFILE ---
@router.put("/update")
async def update_user(
    fullName: str = Form(...),
    email: str = Form(...),
    phoneNumber: str = Form(default=""),
    location: str = Form(default=""),
    profileImage: Optional[UploadFile] = File(None),
    user_id: Optional[str] = Form(None),  # ignored: identity comes from the token
    current: dict = Depends(get_current_user),
    db = Depends(get_db)
):
    return await auth.update_user_logic(
        user_id=current["id"],
        fullName=fullName,
        email=email,
        phoneNumber=phoneNumber,
        location=location,
        profileImage=profileImage,
        db=db
    )


# --- 5. LIST ALL USERS (ADMIN) ---
@router.get("/users")
async def list_users(admin: dict = Depends(require_admin), db = Depends(get_db)):
    return await auth.get_all_users_logic(db)


# --- 6. CHANGE USER ROLE (ADMIN) ---
@router.put("/users/{user_id}/role")
async def change_user_role(user_id: str, body: dict = Body(...), admin: dict = Depends(require_admin), db = Depends(get_db)):
    new_role = body.get("role")
    if not new_role:
        raise HTTPException(status_code=400, detail="'role' field is required")
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="You cannot change your own role")
    return await auth.update_user_role_logic(user_id, new_role, db)


# --- 7. TOGGLE USER STATUS (ADMIN) ---
@router.put("/users/{user_id}/status")
async def toggle_user_status(user_id: str, body: dict = Body(...), admin: dict = Depends(require_admin), db = Depends(get_db)):
    is_active = body.get("is_active")
    reason = body.get("reason")
    if is_active is None:
        raise HTTPException(status_code=400, detail="'is_active' field is required")
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="You cannot deactivate yourself")
    return await auth.toggle_user_status_logic(user_id, is_active, reason, db)