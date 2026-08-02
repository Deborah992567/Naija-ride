"""Place search + reverse geocoding via OpenStreetMap's Nominatim API.

Proxied server-side so the mobile app never calls the upstream directly
(CORS-free, single rate limiter, attribution centralized). See
https://operations.osmfoundation.org/policies/nominatim/ for usage policy.
"""
import httpx
from fastapi import APIRouter, HTTPException, Query

from ..config import CACHE_TTL_PLACES
from ..core.cache import cache
from ..core.http import CircuitOpenError, client_request

router = APIRouter(prefix="/api", tags=["places"])

NOMINATIM = "https://nominatim.openstreetmap.org"
HEADERS = {"User-Agent": "NaijaRide/1.0 (ride-booking-app; support@naijaride.local)"}
TIMEOUT = httpx.Timeout(10.0)


def _place_from_json(item: dict) -> dict:
    addr = item.get("address") or {}
    return {
        "name": item.get("display_name") or item.get("name") or "Unknown place",
        "lat": float(item.get("lat") or 0),
        "lng": float(item.get("lon") or 0),
        "state": addr.get("state") or addr.get("state_district") or addr.get("region") or addr.get("province") or None,
        "city": addr.get("city") or addr.get("town") or addr.get("village") or None,
        "category": item.get("type") or item.get("class") or None,
    }


@router.get("/places/search")
async def search_places(
    q: str = Query(..., min_length=1, max_length=120),
    limit: int = Query(8, ge=1, le=20),
):
    query = q.strip()
    if not query:
        return []
    cache_key = f"places:search:{query.lower()}:{limit}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    params = {
        "q": query,
        "format": "jsonv2",
        "addressdetails": 1,
        "limit": limit,
        "countrycodes": "ng",
        "accept-language": "en",
    }
    try:
        resp = await client_request(
            "GET", f"{NOMINATIM}/search", headers=HEADERS, timeout=TIMEOUT, params=params
        )
        data = resp.json()
    except (httpx.HTTPError, ValueError, CircuitOpenError, RuntimeError) as e:
        raise HTTPException(status_code=502, detail=f"Places search unavailable: {e}") from e
    results = [_place_from_json(item) for item in data if item.get("lat") and item.get("lon")]
    # Cache only successful lookups so transient upstream failures don't go stale.
    cache.set(cache_key, results, ttl=CACHE_TTL_PLACES)
    return results


@router.get("/places/reverse")
async def reverse_geocode(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
):
    params = {
        "lat": lat,
        "lon": lng,
        "format": "jsonv2",
        "addressdetails": 1,
        "accept-language": "en",
        "zoom": 17,
    }
    cache_key = f"places:reverse:{round(lat, 5)}:{round(lng, 5)}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached
    try:
        resp = await client_request(
            "GET", f"{NOMINATIM}/reverse", headers=HEADERS, timeout=TIMEOUT, params=params
        )
        item = resp.json()
    except (httpx.HTTPError, ValueError, CircuitOpenError, RuntimeError) as e:
        raise HTTPException(status_code=502, detail=f"Reverse geocoding unavailable: {e}") from e
    if not item or item.get("error"):
        raise HTTPException(status_code=404, detail="No place found for these coordinates")
    result = _place_from_json(item)
    cache.set(cache_key, result, ttl=CACHE_TTL_PLACES)
    return result
