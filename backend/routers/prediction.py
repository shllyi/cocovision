import httpx
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, File, UploadFile, Form
from pydantic import BaseModel
from typing import Optional, List
from services.market_analysis import market_analyzer
from services.notifications import broadcast_notification as _broadcast
from database import get_db
from bson import ObjectId
import os
import uuid
import aiofiles
from datetime import datetime, timedelta
from services.deps import require_admin

router = APIRouter(prefix="/prediction", tags=["Market Prediction"])

NPOINT_API_URL = "https://api.npoint.io/085d85e25d5eede85e0f"

class PriceItem(BaseModel):
    id: str
    name: str
    price: float
    unit: str
    trend: str
    advice: str
    forecast_7_day: Optional[float] = None
    forecast_14_day: Optional[float] = None
    forecast_30_day: Optional[float] = None
    trend_percent: Optional[float] = None
    confidence: Optional[str] = None

class ForecastRequest(BaseModel):
    historical_prices: List[float]

# ==================== MAIN ENDPOINTS ====================

@router.get("/prices")
async def get_market_prices():
    """Fetch live coconut product prices from npoint API with predictions"""
    try:
        prices, last_updated = await market_analyzer.fetch_npoint_prices(NPOINT_API_URL)
        
        # Get database for historical data
        db = get_db()
        
        # Enrich with predictions from historical data (NO AUTO-SYNC)
        enriched_prices = []
        for price in prices:
            product_id = price.get("id")
            history = await market_analyzer.get_price_history(db, product_id, days=30)
            
            if len(history) >= 5:
                historical_values = [h["price"] for h in history]
                forecast = market_analyzer.predict_price_advanced(
                    product_id, historical_values, price.get("name")
                )
                if forecast:
                    price["forecast_7_day"] = forecast["forecast_7_day"]
                    price["forecast_14_day"] = forecast["forecast_14_day"]
                    price["forecast_30_day"] = forecast["forecast_30_day"]
                    price["trend_percent"] = forecast["trend_percent"]
                    price["confidence"] = forecast["confidence"]
                    price["model_accuracy"] = forecast["model_accuracy"]
            
            enriched_prices.append(price)
        
        return {
            "prices": enriched_prices,
            "last_updated": last_updated,
            "total_products": len(enriched_prices)
        }
    except Exception as e:
        print(f"Error fetching prices: {e}")
        # Fallback to npoint only
        prices, last_updated = await market_analyzer.fetch_npoint_prices(NPOINT_API_URL)
        return {"prices": prices, "last_updated": last_updated, "total_products": len(prices)}

@router.get("/insights")
async def get_market_insights():
    """Get comprehensive market insights and highlights"""
    try:
        prices, last_updated = await market_analyzer.fetch_npoint_prices(NPOINT_API_URL)
        df = pd.DataFrame(prices)
        
        insights = market_analyzer.get_market_insights(df)
        highlights = market_analyzer.get_product_highlights(prices)
        
        return {
            "insights": insights,
            "highlights": highlights,
            "last_updated": last_updated
        }
    except Exception as e:
        print(f"Error in insights: {e}")
        return {"error": str(e)}

@router.get("/history/{product_id}")
async def get_price_history(product_id: str, days: int = 30):
    """Get historical price data for a specific product"""
    try:
        db = get_db()
        history = await market_analyzer.get_price_history(db, product_id, days)
        
        return {
            "product_id": product_id,
            "history": history,
            "data_points": len(history),
            "days_requested": days
        }
    except Exception as e:
        print(f"Error getting history: {e}")
        return {"error": str(e)}

@router.get("/chart/{product_id}")
async def get_chart_data(product_id: str, days: int = 30, forecast_days: int = 7):
    """Get chart-ready data with historical and forecast points"""
    try:
        db = get_db()
        history = await market_analyzer.get_price_history(db, product_id, days)
        
        if len(history) < 2:
            return {"error": "Not enough historical data for chart", "data_points": len(history)}
        
        historical_prices = [h["price"] for h in history]
        chart_data = market_analyzer.generate_chart_data(historical_prices, forecast_days)
        
        return {
            "product_id": product_id,
            "chart_data": chart_data,
            "data_points": len(history)
        }
    except Exception as e:
        print(f"Error generating chart: {e}")
        return {"error": str(e)}

@router.post("/forecast/{product_id}")
async def get_advanced_forecast(product_id: str, request: ForecastRequest):
    """
    Get detailed ML forecast for a product
    Pass historical prices as body: {"historical_prices": [38, 37.5, 38.2, 39, 38.8]}
    """
    try:
        if len(request.historical_prices) < 5:
            return {"error": "Need at least 5 data points for accurate prediction"}
        
        forecast = market_analyzer.predict_price_advanced(
            product_id, request.historical_prices, "Custom Product"
        )
        
        # Also generate chart data
        chart_data = market_analyzer.generate_chart_data(request.historical_prices, 7)
        
        return {
            "forecast": forecast,
            "chart_data": chart_data
        }
    except Exception as e:
        print(f"Error in forecast: {e}")
        return {"error": str(e)}

@router.post("/sync")
async def sync_prices_manually(admin: dict = Depends(require_admin), db=Depends(get_db)):
    """
    Manually sync prices from npoint to database
    ADMIN ONLY - Only admins can sync/save prices to history
    """
    try:
        prices, _ = await market_analyzer.fetch_npoint_prices(NPOINT_API_URL)
        count = await market_analyzer.sync_prices_to_db(db, prices, source="npoint")

        # Broadcast notification to all users
        await _broadcast(
            db,
            notif_type="price_update",
            title="📈 Coconut Product Prices Updated",
            message="Latest coconut product market prices have been synced. Check the Prediction tab for updated forecasts.",
            data={"source": "npoint_sync"},
        )

        return {
            "success": True,
            "synced_records": count,
            "message": f"Synced {count} price records to database"
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error syncing: {e}")
        return {"success": False, "error": str(e)}

@router.get("/explanation")
async def get_prediction_explanation():
    """Returns simple explanation of how the prediction system works"""
    return {
        "title": "How Does Price Prediction Work?",
        "summary": "The system learns from price history to predict future prices.",
        "workflow": [
            {
                "step": 1,
                "title": "Update Prices on npoint",
                "description": "Go to your npoint dashboard and change prices for products. Example: Change Copra price from 38 to 39."
            },
            {
                "step": 2,
                "title": "Tap 'Sync Prices' Button",
                "description": "Come back to the app and tap the sync button. This saves your latest prices to our database with today's date and time."
            },
            {
                "step": 3,
                "title": "System Builds Price History",
                "description": "Every time you sync, we record: Product name, Price, Date, Trend (up/down/steady). After 5+ syncs, we have enough data."
            },
            {
                "step": 4,
                "title": "AI Predicts Future Prices",
                "description": "Once we have 5+ price records, our AI analyzes the pattern. Example: If price went 38→38.5→39, it might predict 39.5 next week."
            },
            {
                "step": 5,
                "title": "See Forecasts",
                "description": "The app shows: Current Price, 7-day forecast, 14-day forecast, 30-day forecast, and confidence level (High/Medium/Low)."
            }
        ],
        "how_to_save": {
            "title": "How Prices Get Saved",
            "steps": [
                "Edit prices in npoint → Copy new URL or update values",
                "Open Cocotry app → Go to Market Predictions tab",
                "See current prices displayed from npoint",
                "TAP 'SYNC PRICES' BUTTON (top right) → Prices are saved to database",
                "Wait 5+ syncs → Forecasts will appear automatically"
            ]
        },
        "important_notes": [
            "❌ Just viewing prices does NOT save them to history",
            "✅ You MUST tap 'Sync' to record prices",
            "📊 More price history = Better predictions",
            "⏰ Sync regularly (daily/weekly) for accurate trends"
        ],
        "confidence_levels": {
            "high": "30+ price records (monthly data)",
            "medium": "14-29 records (2-4 weeks data)",
            "low": "5-13 records (1 week data)",
            "none": "Less than 5 records (not enough data yet)"
        }
    }

# ==================== COPRA PRICES ENDPOINTS ====================

@router.post("/upload-copra-image")
async def upload_copra_price_image(
    files: List[UploadFile] = File(...),
    user_id: Optional[str] = Form(None),  # ignored: identity comes from the token
    admin: dict = Depends(require_admin),
    db=Depends(get_db)
):
    """
    Upload and process multiple copra price table images
    ADMIN ONLY - Extract prices using OCR and merge into database
    """
    try:
        # Create uploads directory if it doesn't exist
        upload_dir = "uploads/copra_prices"
        os.makedirs(upload_dir, exist_ok=True)
        
        # Process all uploaded files
        total_regions = set()
        all_prices = []
        total_confidence = 0
        processed_files = 0
        failed_messages = []
        
        for file in files:
            # Validate file type
            if not file.content_type.startswith('image/'):
                failed_messages.append(f"{file.filename}: Not a valid image file.")
                continue
            
            # Read file content
            content = await file.read()
            
            # Generate unique filename
            file_extension = file.filename.split('.')[-1] if '.' in file.filename else 'jpg'
            unique_filename = f"{uuid.uuid4()}.{file_extension}"
            file_path = os.path.join(upload_dir, unique_filename)
            
            # Save uploaded file
            async with aiofiles.open(file_path, 'wb') as f:
                await f.write(content)
            
            # Process image with OCR
            result = await market_analyzer.process_image_with_tesseract(content, file_path)
            
            if result["success"]:
                # Track all regions found across all files
                for price in result["extracted_data"]["prices"]:
                    region = price["region"]
                    total_regions.add(region)
                    # Keep unique regions (merge)
                    if not any(p["region"] == region for p in all_prices):
                        all_prices.append(price)
                    else:
                        # Update existing region
                        for p in all_prices:
                            if p["region"] == region:
                                p.update(price)
                
                total_confidence += result["confidence_score"]
                processed_files += 1
            else:
                failed_messages.append(f"{file.filename}: {result.get('message', 'Processing failed.')}")
        
        if processed_files == 0:
            return {
                "success": False,
                "message": failed_messages[0] if len(failed_messages) == 1 else "No copra price data could be extracted from the uploaded image(s).",
                "details": failed_messages,
                "confidence_score": 0.0,
                "processing_time": 0,
                "extracted_regions": 0,
                "files_processed": 0
            }
        
        # Create merged data
        merged_data = {
            "date": datetime.utcnow().isoformat(),
            "prices": all_prices,
            "source": "admin_upload_tesseract",
            "image_path": upload_dir
        }
        
        # Save to database (will merge with existing record for today)
        save_success = await market_analyzer.save_copra_prices_to_db(db, merged_data)
        
        if save_success:
            avg_confidence = total_confidence / processed_files

            # Broadcast copra price update to all users
            await _broadcast(
                db,
                notif_type="copra_price",
                title="🫕 Copra Farmgate/Millgate Prices Updated",
                message=f"New copra market prices uploaded for {len(total_regions)} region(s). Check the Prediction tab for the latest rates.",
                data={"regions_count": len(total_regions)},
            )

            return {
                "success": True,
                "message": f"Successfully processed {processed_files} image(s) and extracted prices for {len(total_regions)} regions",
                "confidence_score": round(avg_confidence, 2),
                "processing_time": 0,
                "extracted_regions": len(total_regions),
                "files_processed": processed_files
            }
        else:
            return {
                "success": False,
                "message": "Images processed but failed to save to database",
                "confidence_score": 0,
                "processing_time": 0,
                "extracted_regions": len(total_regions),
                "files_processed": processed_files
            }
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error uploading images: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Upload error: {str(e)}")

@router.get("/copra-prices")
async def get_current_copra_prices(db=Depends(get_db)):
    """Get the most current copra market prices by region"""
    try:
        current_prices = await market_analyzer.get_current_copra_prices(db)
        
        if current_prices:
            return {
                "success": True,
                "data": current_prices,
                "message": "Current copra prices retrieved successfully"
            }
        else:
            return {
                "success": False,
                "message": "No copra price data available. Please upload an image first."
            }
            
    except Exception as e:
        print(f"Error fetching copra prices: {e}")
        return {"success": False, "error": str(e)}

@router.get("/copra-history")
async def get_copra_price_history(days: int = 30, db=Depends(get_db)):
    """Get historical copra prices for analysis"""
    try:
        collection = db["copra_market_prices"]
        
        # Get recent records
        start_date = datetime.utcnow() - timedelta(days=days)
        
        cursor = collection.find(
            {"date": {"$gte": start_date}}
        ).sort("processed_at", -1).limit(100)
        
        history = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            doc["date"] = doc["date"].isoformat()
            doc["processed_at"] = doc["processed_at"].isoformat()
            history.append(doc)
        
        return {
            "success": True,
            "data": history,
            "total_records": len(history),
            "days_requested": days
        }
        
    except Exception as e:
        print(f"Error fetching copra history: {e}")
        return {"success": False, "error": str(e)}

@router.get("/copra-history/{region}")
async def get_copra_price_history_by_region(region: str, days: int = 30, db=Depends(get_db)):
    """Get historical copra prices for a specific region"""
    try:
        collection = db["copra_market_prices"]
        
        # Get recent records for the specific region
        start_date = datetime.utcnow() - timedelta(days=days)
        
        cursor = collection.find(
            {"date": {"$gte": start_date}}
        ).sort("processed_at", 1).limit(100)
        
        history_points = []
        async for doc in cursor:
            doc_date = doc["date"]
            
            # Find the price data for this region
            region_price = None
            for price in doc.get("prices", []):
                if price.get("region", "").upper() == region.upper():
                    region_price = price
                    break
            
            if region_price:
                history_points.append({
                    "date": doc_date,
                    "farmgate_price": region_price.get("farmgate_price"),
                    "millgate_price": region_price.get("millgate_price"),
                    "note": region_price.get("note")
                })
        
        return {
            "success": True,
            "region": region,
            "data": history_points,
            "total_records": len(history_points),
            "days_requested": days
        }
        
    except Exception as e:
        print(f"Error fetching copra history for region {region}: {e}")
        return {"success": False, "error": str(e)}

@router.get("/copra-predictions")
async def get_copra_predictions(days: int = 30, db=Depends(get_db)):
    """
    Get AI-generated price predictions for copra based on historical data.
    Returns 7-day and 14-day forecasts for each region's farmgate and millgate prices.
    """
    try:
        predictions = await market_analyzer.get_copra_predictions(db, days)
        return predictions
    except Exception as e:
        print(f"Error getting copra predictions: {e}")
        return {"success": False, "error": str(e)}
