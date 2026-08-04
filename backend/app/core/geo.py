"""Geo helpers shared across the platform (distance, ETA minutes)."""
import math

# Road distance is ~1.3x the straight line in urban Nigeria.
ROAD_FACTOR = 1.3
# Average urban driving speed (km/h) used for ETA + fare time component.
AVG_SPEED_KPH = 24.0


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def road_distance_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    return haversine_km(lat1, lng1, lat2, lng2) * ROAD_FACTOR


def distance_minutes(distance_km: float) -> int:
    road = distance_km * ROAD_FACTOR
    return max(2, int(math.ceil(road / AVG_SPEED_KPH * 60)))


def eta_minutes_between(lat1: float, lng1: float, lat2: float, lng2: float) -> int:
    """Live ETA (whole minutes) between two points at average urban speed."""
    return max(1, int(math.ceil(road_distance_km(lat1, lng1, lat2, lng2) / AVG_SPEED_KPH * 60)))
