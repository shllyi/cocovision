import cloudinary.uploader
import datetime
import os
import json
import re
from pathlib import Path
from bson import ObjectId
from fastapi import HTTPException, status
from typing import Any, Optional


async def create_waste_product_logic(image_file, data: Any, db):
    """
    Uploads a single image to Cloudinary (if provided) and creates a waste-product document.
    `data` may be a Pydantic model or dict-like object containing fields:
    `name`, `description`, `category`, `user_id`.
    """
    secure_url = None
    public_id = None

    # Upload image only if one was provided
    if image_file is not None:
        upload_result = cloudinary.uploader.upload(image_file.file)
        secure_url = upload_result.get("secure_url") or upload_result.get("url")
        public_id = upload_result.get("public_id")

    new_doc = {
        "name": getattr(data, "name", None) or data.get("name"),
        "description": getattr(data, "description", None) or data.get("description"),
        "category": getattr(data, "category", None) or data.get("category"),
        "price": float(getattr(data, "price", None) or data.get("price") or 0.0),
        "unit": getattr(data, "unit", None) or data.get("unit"),
        "image_url": secure_url,
        "cloudinary_public_id": public_id,
        "user_id": str(getattr(data, "user_id", None) or data.get("user_id")),
        "created_at": datetime.datetime.utcnow(),
    }

    result = await db.waste_products.insert_one(new_doc)
    new_doc["_id"] = str(result.inserted_id)
    return new_doc


async def get_all_waste_products_logic(db):
    cursor = db.waste_products.find().sort("created_at", -1)
    items = await cursor.to_list(length=100)
    for it in items:
        it["_id"] = str(it["_id"])
    return items


async def get_waste_product_logic(product_id: str, db):
    try:
        oid = ObjectId(product_id)
    except Exception:
        doc = await db.waste_products.find_one({"_id": product_id})
        if not doc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Waste product not found")
        doc["_id"] = str(doc["_id"])
        return doc

    doc = await db.waste_products.find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Waste product not found")
    doc["_id"] = str(doc["_id"])
    return doc


async def update_waste_product_logic(
    product_id: str,
    data: Any,
    image_file: Optional[Any],
    db,
):
    # resolve id
    try:
        oid = ObjectId(product_id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid product ID")

    existing = await db.waste_products.find_one({"_id": oid})
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Waste product not found")

    update_doc = {}
    # extract fields from pydantic model or dict
    if hasattr(data, "dict"):
        update_doc = data.dict(exclude_unset=True)
    elif hasattr(data, "model_dump"):
        update_doc = data.model_dump(exclude_unset=True)
    else:
        update_doc = dict(data)

    # handle image replacement
    if image_file:
        # delete old image from Cloudinary
        old_public_id = existing.get("cloudinary_public_id")
        if old_public_id:
            try:
                cloudinary.uploader.destroy(old_public_id)
            except Exception:
                pass
        upload_result = cloudinary.uploader.upload(image_file.file)
        update_doc["image_url"] = upload_result.get("secure_url") or upload_result.get("url")
        update_doc["cloudinary_public_id"] = upload_result.get("public_id")

    # Ensure price/unit types are handled when passed as strings via form
    if "price" in update_doc:
        try:
            update_doc["price"] = float(update_doc["price"])
        except Exception:
            update_doc["price"] = 0.0

    if "unit" in update_doc:
        update_doc["unit"] = update_doc["unit"] or None

    if update_doc:
        update_doc["updated_at"] = datetime.datetime.utcnow()
        await db.waste_products.update_one({"_id": oid}, {"$set": update_doc})

    doc = await db.waste_products.find_one({"_id": oid})
    doc["_id"] = str(doc["_id"])
    return doc


async def delete_waste_product_logic(product_id: str, db):
    try:
        oid = ObjectId(product_id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid product ID")

    existing = await db.waste_products.find_one({"_id": oid})
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Waste product not found")

    public_id = existing.get("cloudinary_public_id")
    if public_id:
        try:
            cloudinary.uploader.destroy(public_id)
        except Exception:
            pass

    await db.waste_products.delete_one({"_id": oid})
    return {"status": "deleted", "id": product_id}


# ─── AI-Powered Discovery Engine ─────────────────────────────────────────────

async def discover_waste_products_logic(query: str, category: Optional[str], db):
    """
    Uses Gemini AI to rank and explain which waste products best match the
    user's waste material query. Falls back to keyword matching if AI is
    unavailable or returns no results.
    """
    from dotenv import load_dotenv
    from google import genai

    env_path = Path(__file__).resolve().parent.parent / ".env"
    load_dotenv(dotenv_path=env_path)
    API_KEY = os.getenv("GEMINI_API_KEY")

    # ── 1. Fetch products (optionally pre-filter by category) ──────────────
    query_filter: dict = {}
    if category:
        query_filter = {"category": {"$regex": f"^{category}$", "$options": "i"}}

    cursor = db.waste_products.find(query_filter)
    all_products = await cursor.to_list(length=200)
    print(f"🔍 discover: query='{query}' category='{category}' products_found={len(all_products)}")

    if not all_products:
        return {"results": [], "ai_powered": False, "message": "No products found."}

    # ── 2. Serialise for the prompt ────────────────────────────────────────
    slim_list = [
        {
            "id": str(p["_id"]),
            "name": p.get("name", ""),
            "category": p.get("category", ""),
            "description": p.get("description", ""),
            "price": p.get("price", 0),
            "unit": p.get("unit", ""),
        }
        for p in all_products
    ]
    product_map = {str(p["_id"]): p for p in all_products}
    products_json = json.dumps(slim_list, ensure_ascii=False)

    # ── 3. Build combined Gemini prompt (ONE call for both matches + ideas) ──
    db_names_str = ", ".join(p.get("name", "") for p in slim_list)
    waste_target = query if query else (f"{category} waste" if category else "coconut waste")
    cat_hint = (category or "Husk").split(",")[0].strip()

    prompt = f"""You are a coconut agro-industry expert in the Philippines.
Waste material: "{waste_target}"{(' | Category: ' + category) if category else ''}

DB products JSON:
{products_json}

Return ONLY a raw JSON object (no markdown, no fences):
{{
  "matches": [
    {{"product_id":"<id>","explanation":"1-2 sentences why it fits.","tip":"1-2 sentences how to process."}}
  ],
  "suggestions": [
    {{"name":"max 5 words","description":"1 sentence.","category":"{cat_hint}","materials":["m1","m2","m3"],"steps":["Step 1","Step 2","Step 3","Step 4"]}}
  ]
}}

Rules for matches:
- Include ALL relevant DB products (up to 6), ranked by relevance. Use exact product_id values.
- If no clear relevance, still return top 6 by category match.

Rules for suggestions (NEW ideas NOT in DB):
- Exactly 3 brand-new product ideas NOT listed in: {db_names_str}
- name: max 5 words | description: 1 sentence | category: one of Husk/Shell/Leaves
- materials: exactly 3-4 short items | steps: exactly 4 short action sentences

Return ONLY the JSON object. Nothing else."""

    _MODEL_CANDIDATES = [
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-flash-lite-latest',
        'gemini-3-flash-preview',
        'gemini-3.1-flash-lite-preview',
    ]

    # ── 4. Single Gemini call (returns both sections) ──────────────────────
    ai_reply = None
    if API_KEY:
        for model_name in _MODEL_CANDIDATES:
            try:
                print(f"🤖 discover: trying model {model_name}")
                client = genai.Client(api_key=API_KEY)
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config=genai.types.GenerateContentConfig(
                        temperature=0.2,
                        max_output_tokens=4096,
                    ),
                )
                ai_reply = (response.text or "").strip()
                print(f"✅ discover: model={model_name} reply_len={len(ai_reply)} preview={ai_reply[:150]!r}")
                if ai_reply:
                    break
            except Exception as e:
                print(f"⚠️ discover model {model_name} failed: {e}")
                continue

    # ── 5. Parse combined AI response ─────────────────────────────────────
    ai_matches = []
    ai_suggestions = []
    if ai_reply:
        clean = re.sub(r"```(?:json)?\s*", "", ai_reply).strip().strip("`").strip()
        parsed_obj = None
        # Attempt 1: direct parse as object
        try:
            parsed_obj = json.loads(clean)
            print(f"✅ discover: parsed combined object ok")
        except Exception:
            # Attempt 2: find outermost {...} block
            obj_match = re.search(r"\{.*\}", clean, re.DOTALL)
            if obj_match:
                try:
                    parsed_obj = json.loads(obj_match.group())
                    print(f"✅ discover: regex-extracted combined object")
                except Exception:
                    pass

        if parsed_obj and isinstance(parsed_obj, dict):
            ai_matches = parsed_obj.get("matches") or []
            ai_suggestions = parsed_obj.get("suggestions") or []
            print(f"✅ discover: matches={len(ai_matches)} suggestions={len(ai_suggestions)}")
        elif parsed_obj and isinstance(parsed_obj, list):
            # Fallback: AI returned a bare array (matches only)
            ai_matches = parsed_obj
            print(f"⚠️ discover: got bare array, no suggestions")
        else:
            print(f"⚠️ discover: all parse attempts failed. raw='{ai_reply[:300]}'")

    # ── 6. Enrich AI matches with full product data ───────────────────────
    results = []
    if ai_matches:
        for item in ai_matches:
            pid = (item.get("product_id") or "").strip()
            if pid and pid in product_map:
                full = dict(product_map[pid])
                full["_id"] = str(full["_id"])
                results.append({
                    "product": full,
                    "explanation": item.get("explanation", ""),
                    "tip": item.get("tip", ""),
                })
        print(f"✅ discover: enriched {len(results)} results from AI")

    # ── 7. Keyword-match fallback if AI gave nothing ───────────────────────
    if not results:
        print("⚠️ discover: AI gave no results, falling back to keyword search")
        # Split query into individual words for broader matching
        words = [w for w in (query or "").lower().split() if len(w) > 2]
        # Also include category as a keyword
        if category:
            words.append(category.lower())

        def product_score(p: dict) -> int:
            text = f"{p['name']} {p['category']} {p['description']}".lower()
            if not words:
                return 1  # no query → match everything
            return sum(1 for w in words if w in text)

        scored = [(product_score(p), p) for p in slim_list]
        scored = [(s, p) for s, p in scored if s > 0 or not words]
        scored.sort(key=lambda x: -x[0])
        top = scored[:6]

        for _, pm in top:
            full = dict(product_map.get(pm["id"], {}))
            if full:
                full["_id"] = str(full["_id"])
                results.append({
                    "product": full,
                    "explanation": f"This product is derived from coconut {pm.get('category', 'waste').lower()} and matches your search.",
                    "tip": "Consult local coconut processors or the Philippine Coconut Authority for the best methods to produce this item.",
                })
        print(f"✅ discover: keyword fallback returned {len(results)} results")

    return {
        "results": results,
        "ai_suggestions": ai_suggestions,
        "ai_powered": bool(ai_matches and results),
    }
