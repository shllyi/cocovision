import pandas as pd
import numpy as np
from sklearn.preprocessing import MinMaxScaler
from sklearn.linear_model import LinearRegression
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from datetime import datetime, timedelta
import httpx
import asyncio
import os
import re
import json
import base64
from typing import Optional, List, Dict

# Import Google Generative AI for Gemini
try:
    import google.generativeai as genai
    from config import settings
    genai.configure(api_key=settings.gemini_api_key)
    GEMINI_AVAILABLE = True
except ImportError as e:
    print(f"Warning: Google Generative AI not available: {e}")
    GEMINI_AVAILABLE = False

# Try to import image processing libraries, but handle missing dependencies
try:
    from PIL import Image
    import pytesseract
    import cv2
    from io import BytesIO
    IMAGE_PROCESSING_AVAILABLE = True
except ImportError as e:
    print(f"Warning: Image processing libraries not available: {e}")
    print("OCR functionality will be disabled. Install with: pip install pytesseract opencv-python pillow")
    IMAGE_PROCESSING_AVAILABLE = False

class MarketAnalyzer:
    """Analyzes market prices and predicts trends using ML"""
    
    def __init__(self):
        self.scaler = MinMaxScaler()
        self.price_history = {}  # Store price history for trend analysis
        self.models = {}  # Cache trained models per product
        
    async def fetch_npoint_prices(self, api_url: str):
        """Fetch prices from npoint API"""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(api_url)
                response.raise_for_status()
                data = response.json()
                return data.get("prices", []), data.get("last_updated", None)
        except Exception as e:
            print(f"Error fetching prices: {e}")
            return [], None
    
    async def sync_prices_to_db(self, db, prices: list, source: str = "npoint"):
        """Save fetched prices to database for history tracking"""
        if not prices:
            return
        
        collection = db["price_history"]
        records = []
        
        for price in prices:
            record = {
                "product_id": price.get("id"),
                "product_name": price.get("name"),
                "price": price.get("price"),
                "unit": price.get("unit"),
                "trend": price.get("trend"),
                "advice": price.get("advice"),
                "recorded_at": datetime.utcnow(),
                "source": source
            }
            records.append(record)
        
        if records:
            await collection.insert_many(records)
        
        return len(records)
    
    async def get_price_history(self, db, product_id: str, days: int = 30) -> list:
        """Get historical prices for a product from database"""
        collection = db["price_history"]
        
        start_date = datetime.utcnow() - timedelta(days=days)
        
        cursor = collection.find({
            "product_id": product_id,
            "recorded_at": {"$gte": start_date}
        }).sort("recorded_at", 1)
        
        history = []
        async for doc in cursor:
            history.append({
                "price": doc["price"],
                "date": doc["recorded_at"].isoformat(),
                "source": doc.get("source", "npoint")
            })
        
        return history
    
    async def get_all_products_history(self, db, days: int = 30) -> dict:
        """Get historical prices for all products"""
        collection = db["price_history"]
        
        start_date = datetime.utcnow() - timedelta(days=days)
        
        # Get unique products
        products = await collection.distinct("product_id")
        
        all_history = {}
        for product_id in products:
            all_history[product_id] = await self.get_price_history(db, product_id, days)
        
        return all_history
    
    def predict_price_advanced(self, product_id: str, historical_prices: list, 
                                product_name: str = "Unknown"):
        """
        Advanced ML prediction using ensemble of models
        Returns 7-day, 14-day, and 30-day forecasts with confidence
        """
        if len(historical_prices) < 5:
            # Not enough data, return None
            return None
        
        # Prepare data
        prices = np.array(historical_prices)
        X = np.array(range(len(prices))).reshape(-1, 1)
        y = prices
        
        # Normalize for better training
        y_normalized = self.scaler.fit_transform(y.reshape(-1, 1)).flatten()
        
        # Train multiple models
        lr_model = LinearRegression()
        rf_model = RandomForestRegressor(n_estimators=50, random_state=42)
        
        lr_model.fit(X, y_normalized)
        rf_model.fit(X, y_normalized)
        
        # Predict for 7, 14, 30 days
        n = len(prices)
        future_7 = np.array([[n + 7]])
        future_14 = np.array([[n + 14]])
        future_30 = np.array([[n + 30]])
        
        # Ensemble predictions (average of both models)
        def ensemble_predict(future_X):
            lr_pred = lr_model.predict(future_X)
            rf_pred = rf_model.predict(future_X)
            avg_pred = (lr_pred + rf_pred) / 2
            return self.scaler.inverse_transform(avg_pred.reshape(-1, 1))[0][0]
        
        forecast_7 = round(ensemble_predict(future_7), 2)
        forecast_14 = round(ensemble_predict(future_14), 2)
        forecast_30 = round(ensemble_predict(future_30), 2)
        
        # Calculate trend
        current = float(prices[-1])
        trend_percent = round(((forecast_7 - current) / current) * 100, 2)
        
        # Determine trend direction
        if trend_percent > 1:
            trend_direction = "up"
        elif trend_percent < -1:
            trend_direction = "down"
        else:
            trend_direction = "steady"
        
        # Calculate confidence based on data quality
        if len(prices) >= 30:
            confidence = "high"
        elif len(prices) >= 14:
            confidence = "medium"
        else:
            confidence = "low"
        
        # Calculate model accuracy (R² score) on training data
        lr_score = r2_score(y_normalized, lr_model.predict(X))
        rf_score = r2_score(y_normalized, rf_model.predict(X))
        avg_score = (lr_score + rf_score) / 2
        
        return {
            "product_id": product_id,
            "product_name": product_name,
            "current_price": current,
            "forecast_7_day": forecast_7,
            "forecast_14_day": forecast_14,
            "forecast_30_day": forecast_30,
            "trend_percent": trend_percent,
            "trend_direction": trend_direction,
            "confidence": confidence,
            "model_accuracy": round(avg_score * 100, 1),  # Convert to percentage
            "data_points": len(prices),
            "prediction_date": datetime.utcnow().isoformat()
        }
    
    def generate_chart_data(self, historical_prices: list, forecast_days: int = 7):
        """Generate data points for frontend charts"""
        if len(historical_prices) < 2:
            return None
        
        prices = np.array(historical_prices)
        
        # Historical data points
        history_points = [
            {"day": i + 1, "price": round(float(p), 2), "type": "historical"}
            for i, p in enumerate(prices)
        ]
        
        # Generate forecast points
        X = np.array(range(len(prices))).reshape(-1, 1)
        y_normalized = self.scaler.fit_transform(prices.reshape(-1, 1)).flatten()
        
        model = LinearRegression()
        model.fit(X, y_normalized)
        
        forecast_points = []
        for i in range(1, forecast_days + 1):
            future_X = np.array([[len(prices) + i]])
            pred_normalized = model.predict(future_X)
            pred_price = self.scaler.inverse_transform(pred_normalized.reshape(-1, 1))[0][0]
            forecast_points.append({
                "day": len(prices) + i,
                "price": round(float(pred_price), 2),
                "type": "forecast"
            })
        
        return {
            "history": history_points,
            "forecast": forecast_points,
            "all_points": history_points + forecast_points
        }
    
    def get_product_highlights(self, prices_list: list) -> dict:
        """Get top performers and market highlights"""
        df = pd.DataFrame(prices_list)
        
        # Find biggest gainers (up trend with highest prices)
        gainers = df[df['trend'] == 'up'].nlargest(3, 'price').to_dict('records')
        
        # Find products to watch (down trend)
        decliners = df[df['trend'] == 'down'].to_dict('records')
        
        # Steady performers
        steady = df[df['trend'] == 'steady'].to_dict('records')
        
        # Premium products (highest priced)
        premium = df.nlargest(3, 'price').to_dict('records')
        
        # Budget-friendly (lowest priced)
        budget = df.nsmallest(3, 'price').to_dict('records')
        
        return {
            "top_gainers": gainers,
            "declining": decliners,
            "steady": steady,
            "premium_products": premium,
            "budget_friendly": budget
        }
    
    def get_market_insights(self, df: pd.DataFrame) -> dict:
        """Generate market insights from price data"""
        return {
            "total_products": len(df),
            "average_price": round(float(df['price'].mean()), 2),
            "highest_priced": df.loc[df['price'].idxmax(), 'name'],
            "lowest_priced": df.loc[df['price'].idxmin(), 'name'],
            "trending_up": len(df[df['trend'] == 'up']),
            "trending_down": len(df[df['trend'] == 'down']),
            "price_range": {
                "min": round(float(df['price'].min()), 2),
                "max": round(float(df['price'].max()), 2),
                "median": round(float(df['price'].median()), 2)
            }
        }
    
    def preprocess_image(self, image_data: bytes) -> np.ndarray:
        """Preprocess image for better OCR accuracy"""
        if not IMAGE_PROCESSING_AVAILABLE:
            raise ImportError("Image processing libraries not available. Install pytesseract, opencv-python, and pillow")
        
        try:
            # Convert bytes to numpy array
            nparr = np.frombuffer(image_data, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if img is None:
                raise ValueError("Could not decode image")
            
            # Convert to grayscale
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            
            # Apply threshold to get binary image
            _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            
            # Apply morphological operations to remove noise
            kernel = np.ones((2,2), np.uint8)
            processed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
            
            return processed
        except Exception as e:
            print(f"Image preprocessing error: {e}")
            raise

    def extract_text_from_image(self, image_data: bytes) -> str:
        """Extract text from image using OCR"""
        if not IMAGE_PROCESSING_AVAILABLE:
            raise ImportError("Image processing libraries not available. Install pytesseract, opencv-python, and pillow")
        
        try:
            # Preprocess image
            processed_img = self.preprocess_image(image_data)
            
            # Configure Tesseract for better table recognition
            custom_config = r'--oem 3 --psm 6 -c preserve_interword_spaces=1'
            
            # Extract text
            text = pytesseract.image_to_string(processed_img, config=custom_config)
            
            return text.strip()
        except Exception as e:
            print(f"OCR extraction error: {e}")
            raise
    
    def parse_copra_prices_from_text(self, text: str) -> Optional[Dict]:
        """Parse copra prices from extracted OCR text"""
        try:
            # Define region patterns (more tolerant to OCR errors and font variations)
            region_patterns = [
                r'REGIO[AN]\s+(?:IX|X|XI|XII|XIII|XIV|III|IV-A|MIMAROPA|V|VI|VII|VIII)',
                r'REGIO[AN]\s+[IVX]+(?:-[A-Z])?',
                r'REGIO[ABMN]\s+(?:IX|X|XI|XII|XIII|XIV|III|IV-A|MIMAROPA|V|VI|VII|VIII)',  # Handle OCR errors
                r'REGIO[AN]\s+X[Il1|]{2,3}\b',  # Handle font variations for XII/XIII
                r'REGIO[ABMN]\s+X[Il1|]{2,3}\b',  # Handle font variations with OCR errors
                r'MIMAROPA'
            ]
            
            # Extract date
            date_match = re.search(r'(\w+\s+\d{1,2},?\s+\d{4})', text)
            extracted_date = None
            if date_match:
                try:
                    extracted_date = datetime.strptime(date_match.group(1), '%B %d, %Y')
                except:
                    try:
                        extracted_date = datetime.strptime(date_match.group(1), '%B %d %Y')
                    except:
                        extracted_date = datetime.utcnow()
            else:
                extracted_date = datetime.utcnow()
            
            # Find all price values
            price_pattern = r'[\d,]+\.\d{2}'
            prices = re.findall(price_pattern, text)
            
            # Parse regions and prices
            regions_data = []
            lines = text.split('\n')
            
            current_region = None
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                
                # Check if line contains a region (more tolerant to OCR errors)
                for pattern in region_patterns:
                    region_match = re.search(pattern, line, re.IGNORECASE)
                    if region_match:
                        # Normalize the region name (fix common OCR errors)
                        matched_text = region_match.group().upper()
                        # Fix common OCR errors: REGIOB -> REGION, REGIOM -> REGION, etc.
                        normalized_region = re.sub(r'REGIO[ABMN]', 'REGION', matched_text)
                        current_region = normalized_region
                        break
                
                # If we have a current region, look for prices in this line
                if current_region:
                    line_prices = re.findall(price_pattern, line)
                    if line_prices:
                        region_data = {"region": current_region}
                        
                        # Try to identify farmgate and millgate prices
                        if len(line_prices) >= 2:
                            region_data["farmgate_price"] = float(line_prices[0].replace(',', ''))
                            region_data["millgate_price"] = float(line_prices[1].replace(',', ''))
                        elif len(line_prices) == 1:
                            # Check context to determine if it's farmgate or millgate
                            if 'FARMGATE' in line.upper():
                                region_data["farmgate_price"] = float(line_prices[0].replace(',', ''))
                            elif 'MILLGATE' in line.upper():
                                region_data["millgate_price"] = float(line_prices[0].replace(',', ''))
                            else:
                                region_data["farmgate_price"] = float(line_prices[0].replace(',', ''))
                        
                        # Check for notes like "no oil mills"
                        if 'no oil mills' in line.lower():
                            region_data["note"] = "no oil mills"
                        
                        regions_data.append(region_data)
            
            if not regions_data:
                return None
            
            return {
                "date": extracted_date.isoformat(),
                "prices": regions_data,
                "source": "admin_upload",
                "raw_text": text
            }
            
        except Exception as e:
            print(f"Parse Error: {e}")
            return None
    
    async def process_uploaded_image(self, image_data: bytes, image_path: str = None) -> Dict:
        """Process uploaded image and extract copra price data using Tesseract OCR"""
        start_time = datetime.utcnow()
        
        # Try Tesseract OCR for local, fast extraction
        result = await self.process_image_with_tesseract(image_data, image_path)
        result["processing_time"] = (datetime.utcnow() - start_time).total_seconds()
        return result
    
    async def process_image_with_tesseract(self, image_data: bytes, image_path: str = None) -> Dict:
        """Process copra price image using Tesseract OCR for local, fast extraction"""
        if not IMAGE_PROCESSING_AVAILABLE:
            return {
                "success": False,
                "message": "Image processing libraries not available. Install pytesseract, opencv-python, pillow.",
                "confidence_score": 0.0,
                "processing_time": 0
            }
        
        try:
            import pytesseract
            import os
            from PIL import Image
            import cv2
            import numpy as np
            from io import BytesIO
            import re

            # Fallback to default Windows install path if tesseract is not on PATH
            default_tesseract = "C:/Program Files/Tesseract-OCR/tesseract.exe"
            if os.name == "nt" and os.path.exists(default_tesseract):
                pytesseract.pytesseract.tesseract_cmd = default_tesseract
            
            # Convert bytes to image
            image = Image.open(BytesIO(image_data))
            
            # Convert to OpenCV format (BGR)
            img_cv = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
            
            # Preprocess for better OCR - optimized for table extraction from photos
            # Convert to grayscale
            gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY)
            
            # Method 1: Standard enhancement
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            enhanced1 = clahe.apply(gray)
            
            # Method 2: High contrast enhancement for poor lighting
            lab = cv2.cvtColor(img_cv, cv2.COLOR_BGR2LAB)
            l, a, b = cv2.split(lab)
            clahe2 = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
            l2 = clahe2.apply(l)
            enhanced2 = cv2.merge([l2, a, b])
            enhanced2 = cv2.cvtColor(enhanced2, cv2.COLOR_LAB2BGR)
            enhanced2 = cv2.cvtColor(enhanced2, cv2.COLOR_BGR2GRAY)
            
            # Method 3: Gamma correction for dark images
            gamma = 1.2
            inv_gamma = 1.0 / gamma
            table = np.array([((i / 255.0) ** inv_gamma) * 255 for i in np.arange(0, 256)]).astype("uint8")
            enhanced3 = cv2.LUT(np.uint8(gray), table)
            
            # Try multiple preprocessing methods
            preprocessing_methods = [
                ("standard", enhanced1),
                ("high_contrast", enhanced2),
                ("gamma_corrected", enhanced3)
            ]
            
            best_result = None
            max_regions = 0
            
            for method_name, processed_img in preprocessing_methods:
                print(f"Trying OCR method: {method_name}")
                
                # Apply bilateral filtering to reduce noise while keeping edges sharp
                filtered = cv2.bilateralFilter(processed_img, 9, 75, 75)
                
                # Apply adaptive thresholding for better results on varying lighting
                thresh = cv2.adaptiveThreshold(filtered, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                               cv2.THRESH_BINARY, 11, 2)
                
                # Denoise - morphological operations
                kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
                denoised = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
                denoised = cv2.morphologyEx(denoised, cv2.MORPH_OPEN, kernel)
                
                # Try different Tesseract PSM modes
                psm_modes = [
                    ('--psm 6', 'single uniform block'),
                    ('--psm 4', 'single column'),
                    ('--psm 11', 'sparse text'),
                    ('--psm 3', 'fully automatic')
                ]
                
                for psm_config, psm_desc in psm_modes:
                    try:
                        # Extract text with Tesseract
                        config = f'{psm_config} -c preserve_interword_spaces=1'
                        extracted_text = pytesseract.image_to_string(denoised, lang='eng', config=config)
                        
                        print(f"Method: {method_name}, PSM: {psm_desc}")
                        print(f"Extracted text:\n{extracted_text}\n---END---")
                        
                        # Parse the extracted text
                        regions = self._parse_copra_prices_from_text(extracted_text)
                        
                        if len(regions) > max_regions:
                            max_regions = len(regions)
                            best_result = {
                                "extracted_text": extracted_text,
                                "regions": regions,
                                "method": method_name,
                                "psm": psm_config
                            }
                            print(f"Found {len(regions)} regions with {method_name}+{psm_desc}")
                        
                    except Exception as e:
                        print(f"Error with {method_name}+{psm_config}: {e}")
                        continue
            
            # Use the best result found
            if best_result:
                extracted_text = best_result["extracted_text"]
                regions = best_result["regions"]
                print(f"Best result: {best_result['method']} with {best_result['psm']} - {len(regions)} regions")
            else:
                # Fallback to original method
                filtered = cv2.bilateralFilter(enhanced1, 9, 75, 75)
                thresh = cv2.adaptiveThreshold(filtered, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                               cv2.THRESH_BINARY, 11, 2)
                kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
                denoised = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
                denoised = cv2.morphologyEx(denoised, cv2.MORPH_OPEN, kernel)
                extracted_text = pytesseract.image_to_string(denoised, lang='eng', config='--psm 6 -c preserve_interword_spaces=1')
                regions = self._parse_copra_prices_from_text(extracted_text)
            
            print(f"Extracted text from image:\n{extracted_text}\n---END---")  # Full log for debugging
            print(f"Text length: {len(extracted_text)}")
            
            # Validate that this looks like a PCA copra DMP document before parsing
            if not self._is_copra_document(extracted_text):
                return {
                    "success": False,
                    "message": "Image does not appear to be a PCA Copra Daily Market Price document. Please upload a valid DMP price table image.",
                    "confidence_score": 0.0,
                    "processing_time": 0
                }
            
            # Parse the extracted text to find prices by region
            regions = self._parse_copra_prices_from_text(extracted_text)
            
            if len(regions) == 0:
                return {
                    "success": False,
                    "message": "No copra price regions found in image. Make sure the image contains regional farmgate/millgate price data.",
                    "confidence_score": 0.0,
                    "processing_time": 0
                }
            
            # Calculate confidence based on number of regions found
            # More regions = higher confidence
            if len(regions) >= 10:
                confidence = 0.95
            elif len(regions) >= 7:
                confidence = 0.85
            elif len(regions) >= 5:
                confidence = 0.75
            elif len(regions) >= 3:
                confidence = 0.65
            else:
                confidence = 0.50
            
            return {
                "success": True,
                "message": f"Successfully extracted prices for {len(regions)} regions using Tesseract OCR",
                "extracted_data": {
                    "date": datetime.utcnow().isoformat(),
                    "prices": regions,
                    "source": "admin_upload_tesseract",
                    "image_path": image_path,
                    "raw_text": extracted_text
                },
                "confidence_score": round(confidence, 2),
                "processing_time": 0
            }
        
        except Exception as e:
            print(f"Tesseract processing error: {type(e).__name__}: {e}")
            import traceback
            traceback.print_exc()
            return {
                "success": False,
                "message": f"OCR processing failed: {str(e)}",
                "confidence_score": 0.0,
                "processing_time": 0
            }
    
    def _is_copra_document(self, text: str) -> bool:
        """
        Validate that extracted OCR text is from a PCA Copra Daily Market Price document.
        Returns False for unrelated images (selfies, random photos, non-DMP documents).
        """
        if not text or len(text.strip()) < 20:
            return False

        text_upper = text.upper()

        # Key indicators that should appear in a genuine PCA copra DMP document
        keyword_indicators = [
            "COPRA",
            "FARMGATE",
            "MILLGATE",
            "PCA",
            "PHILIPPINE COCONUT",
            "DAILY MARKET",
            "DMP",
        ]

        # Philippine coconut-producing region names
        region_indicators = [
            "REGION III", "REGION IV", "REGION V", "REGION VI",
            "REGION VII", "REGION VIII", "REGION IX", "REGION X",
            "REGION XI", "REGION XII", "REGION XIII", "MIMAROPA",
            "CARAGA", "BOHOL", "QUEZON", "DAVAO"
        ]

        matched_keywords = sum(1 for kw in keyword_indicators if kw in text_upper)
        has_region = any(r in text_upper for r in region_indicators)

        # Accept if: 2+ keyword matches, OR 1 keyword + a region name
        return matched_keywords >= 2 or (matched_keywords >= 1 and has_region)

    def _parse_copra_prices_from_text(self, text: str) -> List[Dict]:
        """Parse extracted OCR text to find copra prices by region"""
        import re
        
        regions = []
        
        # All Philippine coconut regions with their patterns (more tolerant to OCR errors)
        region_list = [
            ("Region III", [r"REGION\s+III\b", r"REGION\s+3", r"^\s*III\b", r"REGIO[AN]\s+III\b", r"REGIO[ABMN]\s+III\b"]),
            ("Region IV-A", [r"REGION\s+IV-A", r"REGION\s+IV\s+A", r"^\s*IV-A\b", r"^\s*IVA\b", r"REGIO[AN]\s+IV-A", r"REGIO[ABMN]\s+IV-A"]),
            ("MIMAROPA", [r"MIMAROPA", r"REGION\s+IV-B", r"IV-B", r"^\s*MIMAROPA\b"]),
            ("Region V", [r"REGION\s+V\b", r"REGION\s+5\b", r"^\s*V\b", r"REGIO[AN]\s+V\b", r"REGIO[ABMN]\s+V\b"]),
            ("Region VI", [r"REGION\s+VI\b", r"REGION\s+6\b", r"^\s*VI\b", r"REGIO[AN]\s+VI\b", r"REGIO[ABMN]\s+VI\b"]),
            ("Region VII", [r"REGION\s+VII\b", r"REGION\s+7\b", r"^\s*VII\b", r"REGIO[AN]\s+VII\b", r"REGIO[ABMN]\s+VII\b"]),
            ("Region VIII", [r"REGION\s+VIII\b", r"REGION\s+8\b", r"^\s*VIII\b", r"REGIO[AN]\s+VIII\b", r"REGIO[ABMN]\s+VIII\b"]),
            ("Region IX", [r"REGION\s+IX\b", r"REGION\s+9\b", r"^\s*IX\b", r"REGIO[AN]\s+IX\b", r"REGIO[ABMN]\s+IX\b"]),
            ("Region X", [r"REGION\s+X\b", r"REGION\s+10\b", r"^\s*X\b", r"REGIO[AN]\s+X\b", r"REGIO[ABMN]\s+X\b"]),
            ("Region XI", [r"REGION\s+XI\b", r"REGION\s+11\b", r"^\s*XI\b", r"REGIO[AN]\s+XI\b", r"REGIO[ABMN]\s+XI\b"]),
            ("Region XII", [r"REGION\s+XII\b", r"REGION\s+12\b", r"^\s*XII\b", r"REGIO[AN]\s+XII\b", r"REGIO[ABMN]\s+XII\b", r"REGION\s+XII(?=\W|$)", r"REGIO[AN]\s+XII(?=\W|$)", r"REGION\s+X[Il1l!|]{2}(?=\W|$)", r"REGIO[AN]\s+X[Il1l!|]{2}(?=\W|$)", r"REGIO[ABMN]\s+X[Il1l!|]{2}(?=\W|$)"]),  # Fixed: Use lookahead instead of word boundary for font variations
            ("Region XIII", [r"REGION\s+XIII\b", r"REGION\s+13\b", r"^\s*XIII\b", r"REGIO[AN]\s+XIII\b", r"REGIO[ABMN]\s+XIII\b", r"REGION\s+XIII(?=\W|$)", r"REGIO[AN]\s+XIII(?=\W|$)", r"REGION\s+X[Il1l!|]{3}(?=\W|$)", r"REGIO[AN]\s+X[Il1l!|]{3}(?=\W|$)", r"REGIO[ABMN]\s+X[Il1l!|]{3}(?=\W|$)"]),  # Fixed: Use lookahead instead of word boundary for font variations
            ("Region XIV", [r"REGION\s+XIV\b", r"REGION\s+14\b", r"^\s*XIV\b", r"REGIO[AN]\s+XIV\b", r"REGIO[ABMN]\s+XIV\b"]),
        ]
        
        lines = text.split('\n')
        found_regions = {}
        
        # First pass: Find all regions and their line numbers
        region_line_map = {}
        
        # Process each line for region patterns
        for line_idx, line in enumerate(lines):
            line = line.strip()
            if not line:
                continue
                
            # Check each region pattern
            for region_name, patterns in region_list:
                if region_name not in region_line_map:  # Only assign first match
                    for pattern in patterns:
                        if re.search(pattern, line, re.IGNORECASE):
                            region_line_map[region_name] = line_idx
                            print(f"Region detection: Found '{region_name}' at line {line_idx}: '{line[:50]}...'")
                            break
        
        print(f"Region mapping complete: {region_line_map}")
        
        # Second pass: Extract prices for each found region
        for region_name, line_idx in region_line_map.items():
            try:
                # Get the line with the region name
                region_line = lines[line_idx].strip()
                
                # Extract prices from this line
                prices = re.findall(r'\d+(?:\.\d{1,2})?', region_line)
                
                # If no prices found, try next/previous lines
                if not prices:
                    if line_idx + 1 < len(lines):
                        prices = re.findall(r'\d+(?:\.\d{1,2})?', lines[line_idx + 1])
                    elif line_idx > 0:
                        prices = re.findall(r'\d+(?:\.\d{1,2})?', lines[line_idx - 1])
                
                farmgate = None
                millgate = None
                note = None
                
                # Usually: farmgate is first, millgate is second
                if len(prices) >= 1:
                    try:
                        farmgate = float(prices[0])
                    except (ValueError, IndexError):
                        pass
                
                if len(prices) >= 2:
                    try:
                        millgate = float(prices[1])
                    except (ValueError, IndexError):
                        pass
                
                # Handle "no oil mills" case
                combined_text = lines[line_idx].lower()
                if line_idx + 1 < len(lines):
                    combined_text += '\n' + lines[line_idx + 1].lower()
                if line_idx > 0:
                    combined_text += '\n' + lines[line_idx - 1].lower()
                
                if ("no oil" in combined_text or "no mill" in combined_text) and not millgate:
                    millgate = None
                    note = "no oil mills"
                
                # Only add if we found at least one price
                if farmgate is not None or millgate is not None or note:
                    found_regions[region_name] = {
                        "region": region_name,
                        "farmgate_price": farmgate,
                        "millgate_price": millgate,
                        "note": note
                    }
                    print(f"Found {region_name}: farmgate={farmgate}, millgate={millgate}, note={note}, line='{region_line[:60]}'")
                else:
                    print(f"Region {region_name} found but no price data extracted. Line: '{region_line}'")
            
            except Exception as e:
                print(f"Error parsing {region_name}: {e}")
                continue
        
        print(f"Total regions parsed: {len(regions)}")
        print(f"Regions found: {list(found_regions.keys())}")
        print(f"Regions in final list: {[r['region'] for r in regions]}")
        
        # Sort and return in preset order
        region_order = [
            "Region III", "Region IV-A", "MIMAROPA", "Region V", "Region VI",
            "Region VII", "Region VIII", "Region IX", "Region X", "Region XI",
            "Region XII", "Region XIII", "Region XIV"
        ]
        
        for region_name in region_order:
            if region_name in found_regions:
                regions.append(found_regions[region_name])
        
        print(f"Final sorted regions: {len(regions)} - {[r['region'] for r in regions]}")
        return regions

    
    def calculate_ocr_confidence(self, parsed_data: Dict, raw_text: str) -> float:
        """Calculate confidence score for OCR extraction"""
        try:
            score = 0.0
            
            # Base score for having data
            if parsed_data and parsed_data.get("prices"):
                score += 0.3
            
            # Bonus for number of regions found
            regions_count = len(parsed_data.get("prices", []))
            if regions_count >= 5:
                score += 0.3
            elif regions_count >= 3:
                score += 0.2
            elif regions_count >= 1:
                score += 0.1
            
            # Bonus for price completeness
            complete_prices = 0
            total_price_slots = 0
            for price_data in parsed_data.get("prices", []):
                if price_data.get("farmgate_price") is not None:
                    complete_prices += 1
                total_price_slots += 1
                if price_data.get("millgate_price") is not None:
                    complete_prices += 1
                total_price_slots += 1
            
            if total_price_slots > 0:
                price_completeness = complete_prices / total_price_slots
                score += price_completeness * 0.2
            
            # Bonus for date extraction
            if parsed_data.get("date"):
                score += 0.1
            
            # Bonus for text quality (presence of expected keywords)
            expected_keywords = ["FARMGATE", "MILLGATE", "REGION", "COPRA"]
            keyword_count = sum(1 for keyword in expected_keywords if keyword in raw_text.upper())
            score += (keyword_count / len(expected_keywords)) * 0.1
            
            return min(score, 1.0)
            
        except Exception:
            return 0.0
    
    async def save_copra_prices_to_db(self, db, price_data: Dict) -> bool:
        """Save extracted copra prices to database as new historical record for each upload"""
        try:
            collection = db["copra_market_prices"]
            
            # Create a new document for each upload with full timestamp (enables multiple uploads per day)
            document = {
                "upload_date": datetime.fromisoformat(price_data["date"]),
                "date": datetime.fromisoformat(price_data["date"]).replace(hour=0, minute=0, second=0, microsecond=0),
                "prices": price_data["prices"],
                "source": price_data.get("source", "admin_upload"),
                "image_path": price_data.get("image_path"),
                "processed_at": datetime.utcnow(),
                "raw_text": price_data.get("raw_text", "")
            }
            
            # Insert new document for each upload (creates new history)
            result = await collection.insert_one(document)
            
            print(f"✓ Created new historical record (ID: {result.inserted_id})")
            print(f"  Upload timestamp: {document['upload_date']}")
            print(f"  Regions recorded: {len(price_data['prices'])}")
            print(f"  Regions: {[p['region'] for p in price_data['prices']]}")
            
            return True
            
        except Exception as e:
            print(f"Database Error: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    async def get_current_copra_prices(self, db) -> Optional[Dict]:
        """Get the most recent copra prices from database"""
        try:
            collection = db["copra_market_prices"]
            
            # Get the most recent record (sort by processed_at for full timestamp precision)
            latest = await collection.find_one(
                {},
                sort=[("processed_at", -1)]
            )
            
            if latest:
                print(f"Database: Found latest record with {len(latest.get('prices', []))} regions")
                print(f"Database: Regions in record: {[p['region'] for p in latest.get('prices', [])]}")
                # Convert ObjectId to string and datetime to ISO format
                latest["_id"] = str(latest["_id"])
                latest["date"] = latest["date"].isoformat()
                latest["processed_at"] = latest["processed_at"].isoformat()
                
                return latest
            
            print("Database: No copra price records found")
            return None
            
        except Exception as e:
            print(f"Error fetching current prices: {e}")
            return None
    
    async def get_copra_price_history(self, db, days: int = 30) -> List[Dict]:
        """Get historical copra prices for prediction"""
        try:
            collection = db["copra_market_prices"]
            
            start_date = datetime.utcnow() - timedelta(days=days)
            
            # Debug: Count total documents first
            total_docs = await collection.count_documents({})
            print(f"DEBUG: Total documents in copra_market_prices: {total_docs}")
            
            # Debug: Get all documents without date filter first
            all_docs = await collection.find({}).to_list(length=None)
            print(f"DEBUG: Found {len(all_docs)} total documents")
            if all_docs:
                print(f"DEBUG: Sample document: {all_docs[0]}")
            
            cursor = collection.find(
                {"date": {"$gte": start_date}}
            ).sort("processed_at", 1)
            
            history = []
            async for doc in cursor:
                doc["_id"] = str(doc["_id"])
                doc["date"] = doc["date"].isoformat()
                doc["processed_at"] = doc["processed_at"].isoformat()
                history.append(doc)
            
            print(f"DEBUG: Found {len(history)} documents within date range (last {days} days)")
            return history
            
        except Exception as e:
            print(f"Error fetching copra history: {e}")
            return []
    
    def predict_copra_prices(self, historical_data: List[Dict]) -> Dict:
        """
        Predict copra prices for the next 7 and 14 days based on historical data.
        Uses linear regression for each region's farmgate and millgate prices.
        """
        print(f"DEBUG: predict_copra_prices called with {len(historical_data)} historical records")
        
        # Require minimum historical data for predictions
        if len(historical_data) < 2:
            return {"success": False, "message": "Not enough historical data for prediction (need at least 2 records). Please upload more copra price images."}
        
        try:
            # Organize data by region
            region_data = {}
            
            for record in historical_data:
                record_date = datetime.fromisoformat(record["date"])
                
                for price in record.get("prices", []):
                    region = price.get("region")
                    if not region:
                        continue
                    
                    if region not in region_data:
                        region_data[region] = {
                            "dates": [],
                            "farmgate_prices": [],
                            "millgate_prices": []
                        }
                    
                    region_data[region]["dates"].append(record_date)
                    
                    farmgate = price.get("farmgate_price")
                    millgate = price.get("millgate_price")
                    
                    if farmgate is not None:
                        region_data[region]["farmgate_prices"].append(farmgate)
                    if millgate is not None:
                        region_data[region]["millgate_prices"].append(millgate)
            
            # Generate predictions for each region
            predictions = []
            current_date = datetime.utcnow()
            
            for region, data in region_data.items():
                prediction = {
                    "region": region,
                    "current_farmgate": None,
                    "current_millgate": None,
                    "predicted_farmgate_7d": None,
                    "predicted_farmgate_14d": None,
                    "predicted_millgate_7d": None,
                    "predicted_millgate_14d": None,
                    "farmgate_trend": "steady",
                    "millgate_trend": "steady",
                    "confidence": "low"
                }
                
                # Get current prices (most recent)
                if data["farmgate_prices"]:
                    prediction["current_farmgate"] = data["farmgate_prices"][-1]
                if data["millgate_prices"]:
                    prediction["current_millgate"] = data["millgate_prices"][-1]
                
                # Predict farmgate prices
                if len(data["farmgate_prices"]) >= 2:
                    X = np.array(range(len(data["farmgate_prices"]))).reshape(-1, 1)
                    y = np.array(data["farmgate_prices"])
                    
                    model = LinearRegression()
                    model.fit(X, y)
                    
                    # Predict 7 and 14 days ahead
                    n = len(data["farmgate_prices"])
                    pred_7 = model.predict([[n + 7]])[0]
                    pred_14 = model.predict([[n + 14]])[0]
                    
                    prediction["predicted_farmgate_7d"] = round(max(0, pred_7), 2)
                    prediction["predicted_farmgate_14d"] = round(max(0, pred_14), 2)
                    
                    # Calculate trend
                    if prediction["current_farmgate"]:
                        change_pct = ((pred_7 - prediction["current_farmgate"]) / prediction["current_farmgate"]) * 100
                        if change_pct > 1:
                            prediction["farmgate_trend"] = "up"
                        elif change_pct < -1:
                            prediction["farmgate_trend"] = "down"
                
                # Predict millgate prices
                if len(data["millgate_prices"]) >= 2:
                    X = np.array(range(len(data["millgate_prices"]))).reshape(-1, 1)
                    y = np.array(data["millgate_prices"])
                    
                    model = LinearRegression()
                    model.fit(X, y)
                    
                    n = len(data["millgate_prices"])
                    pred_7 = model.predict([[n + 7]])[0]
                    pred_14 = model.predict([[n + 14]])[0]
                    
                    prediction["predicted_millgate_7d"] = round(max(0, pred_7), 2)
                    prediction["predicted_millgate_14d"] = round(max(0, pred_14), 2)
                    
                    # Calculate trend
                    if prediction["current_millgate"]:
                        change_pct = ((pred_7 - prediction["current_millgate"]) / prediction["current_millgate"]) * 100
                        if change_pct > 1:
                            prediction["millgate_trend"] = "up"
                        elif change_pct < -1:
                            prediction["millgate_trend"] = "down"
                
                # Set confidence level based on data points
                total_points = len(data["farmgate_prices"]) + len(data["millgate_prices"])
                if total_points >= 10:
                    prediction["confidence"] = "high"
                elif total_points >= 5:
                    prediction["confidence"] = "medium"
                else:
                    prediction["confidence"] = "low"
                
                predictions.append(prediction)
            
            return {
                "success": True,
                "predictions": predictions,
                "data_points": len(historical_data),
                "prediction_date": current_date.isoformat(),
                "message": f"Generated predictions for {len(predictions)} regions"
            }
            
        except Exception as e:
            print(f"Prediction error: {e}")
            return {"success": False, "message": f"Prediction error: {str(e)}"}
    
    async def get_copra_predictions(self, db, days: int = 30) -> Dict:
        """Get copra price predictions based on historical data"""
        try:
            # Get historical data
            history = await self.get_copra_price_history(db, days)
            
            if not history:
                return {
                    "success": False,
                    "message": "No historical data available. Please upload copra price images first."
                }
            
            # Generate predictions
            predictions = self.predict_copra_prices(history)
            
            return predictions
            
        except Exception as e:
            print(f"Error getting predictions: {e}")
            return {"success": False, "message": str(e)}


# Global analyzer instance
market_analyzer = MarketAnalyzer()
