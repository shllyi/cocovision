from fastapi import APIRouter, HTTPException
import httpx
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote

router = APIRouter()

# Simple in-memory cache
_news_cache: dict = {"articles": [], "fetched_at": None}
CACHE_TTL_MINUTES = 30

# Google News RSS feeds for coconut-related topics (no API key required)
RSS_FEEDS = [
    ("coconut farming agriculture",   "https://news.google.com/rss/search?q=coconut+farming+agriculture&hl=en-US&gl=US&ceid=US:en"),
    ("coconut copra market price",    "https://news.google.com/rss/search?q=coconut+copra+market+price&hl=en-US&gl=US&ceid=US:en"),
    ("coconut production Philippines","https://news.google.com/rss/search?q=coconut+production+Philippines&hl=en-US&gl=US&ceid=US:en"),
]

EXCLUDE_KEYWORDS = {"recipe", "cocktail", "drink", "dessert", "cake", "baking", "cooking", "game", "crypto", "bitcoin", "beauty", "lotion", "sunscreen"}


@router.get("/coconut")
async def get_coconut_news():
    """Fetch latest coconut news via Google News RSS (no API key required)"""
    global _news_cache

    # Serve from cache if still fresh
    if _news_cache["fetched_at"] and _news_cache["articles"]:
        age = datetime.now(timezone.utc) - _news_cache["fetched_at"]
        if age.total_seconds() < CACHE_TTL_MINUTES * 60:
            return {"articles": _news_cache["articles"]}

    try:
        seen_titles: set[str] = set()
        articles = []
        article_id = 1

        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            for _label, feed_url in RSS_FEEDS:
                try:
                    response = await client.get(
                        feed_url,
                        headers={"User-Agent": "Mozilla/5.0 (compatible; CocovisionBot/1.0)"}
                    )
                    if response.status_code != 200:
                        continue

                    root = ET.fromstring(response.text)
                    ns = {"media": "http://search.yahoo.com/mrss/"}

                    for item in root.findall(".//item"):
                        title = (item.findtext("title") or "").strip()
                        link  = (item.findtext("link")  or "").strip()
                        desc  = (item.findtext("description") or "").strip()
                        pub_date = item.findtext("pubDate") or ""
                        source_el = item.find("source")
                        source_name = source_el.text if source_el is not None else "Google News"

                        content = f"{title} {desc}".lower()

                        # Skip duplicates
                        if title.lower() in seen_titles:
                            continue

                        # Skip excluded topics
                        if any(kw in content for kw in EXCLUDE_KEYWORDS):
                            continue

                        # Must mention coconut or copra
                        if "coconut" not in content and "copra" not in content:
                            continue

                        # Parse publication date
                        try:
                            parsed_date = parsedate_to_datetime(pub_date).isoformat()
                        except Exception:
                            parsed_date = datetime.now(timezone.utc).isoformat()

                        seen_titles.add(title.lower())
                        articles.append({
                            "id": article_id,
                            "title": title,
                            "date": parsed_date,
                            "category": extract_category(title),
                            "excerpt": _strip_html(desc),
                            "link": link,
                            "source": source_name,
                        })
                        article_id += 1

                        if article_id > 10:
                            break

                except Exception as feed_err:
                    print(f"RSS feed error ({feed_url}): {feed_err}")
                    continue

                if article_id > 10:
                    break

        if not articles:
            # Fallback sample data when all feeds fail
            return _sample_articles()

        # Cache and return
        _news_cache["articles"] = articles
        _news_cache["fetched_at"] = datetime.now(timezone.utc)
        return {"articles": articles}

    except Exception as e:
        print(f"Error fetching news: {e}")
        # Return sample data instead of a 500 so the UI stays functional
        return _sample_articles()


def _strip_html(text: str) -> str:
    """Remove basic HTML tags from RSS descriptions."""
    import re
    return re.sub(r"<[^>]+>", "", text).strip()


def _sample_articles() -> dict:
    return {
        "articles": [
            {
                "id": 1,
                "title": "New AI Technology Boosts Coconut Yield by 30%",
                "date": (datetime.now() - timedelta(days=20)).isoformat(),
                "category": "Technology",
                "excerpt": "Cutting-edge AI algorithms are revolutionizing coconut farming with unprecedented accuracy in quality assessment.",
                "link": "https://www.fao.org/agriculture/crops/thematic-sitemap/theme/spi/scpi-home/managing-ecosystems/sustainable-agriculture/en/",
                "source": "Sample Data",
            },
            {
                "id": 2,
                "title": "Global Coconut Market Reaches Record High",
                "date": (datetime.now() - timedelta(days=22)).isoformat(),
                "category": "Market",
                "excerpt": "International demand drives prices up as sustainable farming practices gain momentum worldwide.",
                "link": "https://www.statista.com/topics/5765/coconut-industry-worldwide/",
                "source": "Sample Data",
            },
            {
                "id": 3,
                "title": "Sustainable Farming Practices Show Promise",
                "date": (datetime.now() - timedelta(days=24)).isoformat(),
                "category": "Sustainability",
                "excerpt": "Eco-friendly approaches to coconut cultivation show significant environmental and economic benefits.",
                "link": "https://www.worldwildlife.org/industries/sustainable-agriculture",
                "source": "Sample Data",
            },
            {
                "id": 4,
                "title": "Farmers Embrace Digital Classification Tools",
                "date": (datetime.now() - timedelta(days=26)).isoformat(),
                "category": "Innovation",
                "excerpt": "Mobile apps and AI-powered tools transform traditional farming methods across Southeast Asia.",
                "link": "https://www.philstar.com/business/agriculture",
                "source": "Sample Data",
            },
        ]
    }


def extract_category(title: str) -> str:
    """Extract a category based on title keywords"""
    title_lower = title.lower()
    
    if any(word in title_lower for word in ["ai", "technology", "algorithm", "digital", "robot", "machine learning"]):
        return "Technology"
    elif any(word in title_lower for word in ["market", "price", "trade", "export", "economy"]):
        return "Market"
    elif any(word in title_lower for word in ["sustainable", "environment", "organic", "eco", "green"]):
        return "Sustainability"
    elif any(word in title_lower for word in ["farmer", "agriculture", "harvest", "yield", "crop"]):
        return "Innovation"
    else:
        return "News"
