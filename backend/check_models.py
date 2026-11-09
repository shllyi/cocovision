import os
from pathlib import Path
from dotenv import load_dotenv
from google import genai

# Load .env from the backend folder
env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=env_path)

API_KEY = os.getenv("GEMINI_API_KEY")

if not API_KEY:
    print("❌ ERROR: GEMINI_API_KEY is not set in .env file")
else:
    print(f"✅ API Key found (length: {len(API_KEY)})")
    try:
        client = genai.Client(api_key=API_KEY)
        print("\n🔍 Available models:")
        for model in client.models.list():
            print(f"  - {model.name}")
    except Exception as e:
        print(f"❌ Error: {e}")
