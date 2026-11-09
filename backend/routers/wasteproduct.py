from fastapi import APIRouter, File, UploadFile, Form, Depends, Request, HTTPException, status, Header
from typing import Optional
from pydantic import BaseModel
from services import wasteproduct as waste_service
from services.notifications import broadcast_notification as _broadcast
from database import get_db
from bson import ObjectId
from datetime import datetime
from services.deps import require_admin

class WasteProductUpdateForm:
    def __init__(self, name: Optional[str] = None, description: Optional[str] = None, category: Optional[str] = None):
        self.name = name
        self.description = description
        self.category = category


class DiscoverRequest(BaseModel):
    query: str
    category: Optional[str] = None


router = APIRouter()


@router.post("/discover")
async def discover_waste_products(body: DiscoverRequest, db = Depends(get_db)):
    """
    AI-powered discovery: given a waste material query and optional category,
    returns ranked products with Gemini-generated explanations and processing tips.
    """
    return await waste_service.discover_waste_products_logic(body.query, body.category, db)


@router.post("/create")
async def create_waste_product(
    request: Request,
    image: UploadFile = File(None),
    name: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    category: Optional[str] = Form(None),
    price: Optional[float] = Form(None),
    unit: Optional[str] = Form(None),
    user_id: Optional[str] = Form(None),
    admin: dict = Depends(require_admin),
    db = Depends(get_db)
):
    form = await request.form()
    form_keys = list(form.keys())

    missing = []
    if not name:
        missing.append("name")
    if not description:
        missing.append("description")
    if not category:
        missing.append("category")
    if price is None:
        missing.append("price")

    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "message": "Missing required multipart form fields",
                "missing": missing,
                "received_form_keys": form_keys
            }
        )

    data = {
        "name": name,
        "description": description,
        "category": category,
        "price": price,
        "unit": unit,
        "user_id": admin["id"],  # Use the admin's ID for ownership,
    }

    return await waste_service.create_waste_product_logic(image, data, db)


@router.get("/all")
async def get_all_waste_products(db = Depends(get_db)):
    return await waste_service.get_all_waste_products_logic(db)


@router.get("/{product_id}")
async def get_waste_product(product_id: str, db = Depends(get_db)):
    return await waste_service.get_waste_product_logic(product_id, db)


@router.put("/{product_id}")
async def update_waste_product(
    product_id: str,
    image: UploadFile = File(None),
    name: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    category: Optional[str] = Form(None),
    price: Optional[float] = Form(None),
    unit: Optional[str] = Form(None),
    admin: dict = Depends(require_admin),
    db = Depends(get_db)
):
 
    # Ownership check
    try:
        oid = ObjectId(product_id)
    except:
        raise HTTPException(status_code=400, detail="Invalid product id")

    existing = await db.waste_products.find_one({"_id": oid})
    if not existing:
        raise HTTPException(status_code=404, detail="Waste product not found")

    # Only block if a non-owner, non-admin tries to edit
    # (admin users managing the catalogue should always be allowed)

    update_data = {}
    if name is not None:
        update_data["name"] = name
    if description is not None:
        update_data["description"] = description
    if category is not None:
        update_data["category"] = category
    if price is not None:
        update_data["price"] = price
    if unit is not None:
        update_data["unit"] = unit

    data = update_data

    result = await waste_service.update_waste_product_logic(product_id, data, image, db)

    # Broadcast price update notification if price was changed
    if price is not None:
        product_name = name or existing.get("name", "Waste Product")
        await _broadcast(
            db,
            notif_type="waste_price",
            title="♻️ Waste Product Price Updated",
            message=f"The price of \u201c{product_name}\u201d has been updated to ₱{price:.2f}. Check the marketplace for the latest rates.",
            data={"product_id": product_id, "new_price": price},
        )

    return result


@router.delete("/{product_id}")
async def delete_waste_product(
    product_id: str,
    admin: dict = Depends(require_admin),
    db = Depends(get_db)
):

    try:
        oid = ObjectId(product_id)
    except:
        raise HTTPException(status_code=400, detail="Invalid product id")

    existing = await db.waste_products.find_one({"_id": oid})
    if not existing:
        raise HTTPException(status_code=404, detail="Waste product not found")

    # Allow any authenticated admin to delete catalogue items
    return await waste_service.delete_waste_product_logic(product_id, db)


@router.post('/seed')
async def seed_waste_product(admin: dict = Depends(require_admin), db = Depends(get_db)):
    """Dev helper: insert a sample waste product for testing the admin UI. Admin only."""
    user_id = admin["id"]

    sample = {
        'name': 'Sample Husk Product',
        'description': 'Example product generated for UI testing',
        'category': 'Husk',
        'image_url': 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
        'price': 0.0,
        'unit': 'per kg',
        'cloudinary_public_id': None,
        'user_id': user_id,
        'created_at': datetime.utcnow(),
    }

    result = await db.waste_products.insert_one(sample)
    sample['_id'] = str(result.inserted_id)
    return sample
