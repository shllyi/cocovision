from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    # These names must match your .env file
    mongodb_url: str
    database_name: str
    cloudinary_cloud_name: str
    cloudinary_api_key: str
    cloudinary_api_secret: str
    gemini_api_key: str  # Add this field
    news_api_key: str = ""  # Optional - for fetching live news
    jwt_secret: str
    allow_legacy_bearer: str = "1"

    model_config = SettingsConfigDict(env_file=".env")

# Create a singleton instance to use everywhere
settings = Settings()

