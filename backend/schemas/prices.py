from pydantic import BaseModel, Field, HttpUrl
from datetime import datetime
from typing import Optional, List, Dict
from uuid import UUID

class PriceRecord(BaseModel):
    """Single price record for a product"""
    product_id: str
    product_name: str
    price: float
    unit: str
    trend: str  # 'up', 'down', 'steady'
    advice: Optional[str] = None
    recorded_at: datetime = Field(default_factory=datetime.utcnow)
    source: str = "npoint"  # 'npoint' or 'admin'

class PriceHistory(BaseModel):
    """Historical price data for a product"""
    product_id: str
    product_name: str
    unit: str
    prices: List[dict]  # [{price: float, date: datetime}, ...]
    
class PriceForecast(BaseModel):
    """ML prediction result"""
    product_id: str
    product_name: str
    current_price: float
    forecast_7_day: float
    forecast_14_day: float
    forecast_30_day: float
    trend_percent: float
    trend_direction: str  # 'up', 'down', 'steady'
    confidence: str  # 'high', 'medium', 'low'
    prediction_date: datetime = Field(default_factory=datetime.utcnow)

class MarketInsights(BaseModel):
    """Overall market analysis"""
    total_products: int
    average_price: float
    highest_priced: dict
    lowest_priced: dict
    trending_up: int
    trending_down: int
    trending_steady: int
    price_volatility: float  # standard deviation
    last_updated: datetime

class RegionalPrice(BaseModel):
    """Single regional copra price record"""
    region: str
    farmgate_price: Optional[float] = None
    millgate_price: Optional[float] = None
    note: Optional[str] = None  # e.g., "no oil mills"

class CopraMarketPrices(BaseModel):
    """Daily market prices for copra by region"""
    date: datetime
    prices: List[RegionalPrice]
    source: str = "admin_upload"  # 'admin_upload', 'manual', 'api'
    image_path: Optional[str] = None  # Path to uploaded image
    processed_at: datetime = Field(default_factory=datetime.utcnow)
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat()
        }

class ImageUploadResponse(BaseModel):
    """Response for image upload processing"""
    success: bool
    message: str
    extracted_data: Optional[CopraMarketPrices] = None
    confidence_score: Optional[float] = None
    processing_time: Optional[float] = None

class PricePrediction(BaseModel):
    """Price prediction based on historical data"""
    region: str
    current_farmgate: Optional[float] = None
    current_millgate: Optional[float] = None
    predicted_farmgate_7d: Optional[float] = None
    predicted_millgate_7d: Optional[float] = None
    predicted_farmgate_14d: Optional[float] = None
    predicted_millgate_14d: Optional[float] = None
    trend_direction: str  # 'up', 'down', 'steady'
    confidence: str  # 'high', 'medium', 'low'
    prediction_date: datetime = Field(default_factory=datetime.utcnow)


# Waste-to-Product Recommendation schemas
class WasteProductBase(BaseModel):
    name: str
    description: str
    category: str  # Husk, Shell, Water Waste
    image_url: HttpUrl
    price: float = 0.0
    unit: Optional[str] = None


class WasteProductCreate(WasteProductBase):
    user_id: UUID


class WasteProductUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    image_url: Optional[HttpUrl] = None
    price: Optional[float] = None
    unit: Optional[str] = None


class WasteProductResponse(WasteProductBase):
    id: UUID
    user_id: UUID
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
