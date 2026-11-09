from fastapi import APIRouter, UploadFile, File, HTTPException, Request, Form
from fastapi.responses import JSONResponse
from services import acoustic, acoustic_live
import logging
import traceback

logger = logging.getLogger("uvicorn")

router = APIRouter()

@router.get("/test")
async def test_connection():
    """Test endpoint to verify connection"""
    logger.info("✅ Test connection successful")
    return {"status": "ok", "message": "Backend is reachable"}

@router.post("/audio")
async def analyze_acoustic(request: Request):
    """
    Analyze coconut maturity through acoustic sound analysis.
    Accepts WAV, MP3, or other audio formats supported by librosa.
    """
    logger.info("=" * 50)
    logger.info("📝 NEW ACOUSTIC ANALYSIS REQUEST")
    logger.info("=" * 50)
    logger.info(f"Content-Type: {request.headers.get('content-type')}")
    logger.info(f"Content-Length: {request.headers.get('content-length')}")

    try:
        # Parse multipart form data
        form = await request.form()
        logger.info(f"Form fields: {list(form.keys())}")

        # Debug: log all form field names
        for key in form.keys():
            logger.info(f"  - Field: '{key}'")

        if 'file' not in form:
            logger.error("❌ No 'file' field in form data")
            logger.error(f"Available fields: {list(form.keys())}")
            raise HTTPException(status_code=400, detail="No 'file' field provided in form data")

        file: UploadFile = form['file']

        logger.info(f"✅ File received successfully")
        logger.info(f"📄 Filename: {file.filename}")
        logger.info(f"📝 Content-type: {file.content_type}")

        # Validate audio file
        if not file.content_type:
            logger.error(f"❌ No content type provided")
            raise HTTPException(status_code=400, detail="No content type provided")

        is_audio = any(audio_type in file.content_type for audio_type in ["audio/", "application/octet-stream"])
        if not is_audio:
            logger.error(f"❌ Invalid file type: {file.content_type}")
            raise HTTPException(status_code=400, detail=f"Invalid file type: {file.content_type}. Must be audio (WAV, MP3, etc)")

        logger.info("🚀 Starting acoustic analysis service...")
        result = await acoustic.predict_maturity_from_audio(file)

        logger.info("✅ ANALYSIS SUCCESSFUL")
        logger.info("=" * 50)

        return {
            "success": True,
            "internet_sourced_model": {
                "model_name": result["internet_sourced_model"]["model_name"],
                "stage": result["internet_sourced_model"]["stage"],
                "confidence": float(result["internet_sourced_model"]["confidence"]),
                "advice": result["internet_sourced_model"]["advice"],
                "description": result["internet_sourced_model"]["description"],
                "all_predictions": result["internet_sourced_model"]["all_predictions"],
                "tap_analysis": result["internet_sourced_model"]["tap_analysis"]
            },
            "own_dataset_augmented_model": {
                "model_name": result["own_dataset_augmented_model"]["model_name"],
                "stage": result["own_dataset_augmented_model"]["stage"],
                "confidence": float(result["own_dataset_augmented_model"]["confidence"]),
                "advice": result["own_dataset_augmented_model"]["advice"],
                "description": result["own_dataset_augmented_model"]["description"],
                "all_predictions": result["own_dataset_augmented_model"]["all_predictions"],
                "tap_analysis": result["own_dataset_augmented_model"]["tap_analysis"]
            },
            "metrics": result["metrics"],
            "analysis_summary": result["analysis_summary"]
        }
    except HTTPException as e:
        logger.error(f"❌ HTTP Error: {e.detail}")
        logger.error("=" * 50)
        raise e
    except Exception as e:
        logger.error(f"❌ ANALYSIS FAILED")
        logger.error(f"Error: {str(e)}")
        logger.error(f"Traceback: {traceback.format_exc()}")
        logger.error("=" * 50)

        error_msg = str(e)
        raise HTTPException(status_code=500, detail=error_msg)


@router.post("/live")
async def analyze_live(file: UploadFile = File(...)):
    """Live tap classification. Receives a short audio chunk (about 3 s)."""
    data = await file.read()
    if len(data) < 100:
        raise HTTPException(status_code=400, detail="Empty audio chunk.")
    if len(data) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Chunk too large.")
    try:
        return await acoustic_live.predict_chunk(data)
    except Exception as e:
        logger.error(f"Live chunk failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))