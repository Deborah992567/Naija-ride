"""DB-backed configurable pricing engine.

Stage 3: fares are computed from the `pricing_rules` table (admin-editable in
the Stage 8 admin module), replacing the legacy static FARE_CONFIG. Rules are
resolved per vehicle type: city-specific rules take precedence, otherwise the
nationwide (city=NULL) rule is used.
"""
from datetime import datetime
from dataclasses import dataclass
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import CACHE_TTL_PRICING
from ..core.cache import cache
from ..models.pricing import PricingRule
from ..models.zones import ZoneRule

# Fallback so pricing never breaks even if the table is empty.
_FALLBACK = {"base": 500, "per_km": 220, "per_min": 35, "min_fare": 700.0}


@dataclass
class PricingSnapshot:
    """Serializable stand-in for a PricingRule row (safe to cache)."""
    base_fare: float
    per_km: float
    per_minute: float
    min_fare: Optional[float]
    night_multiplier: Optional[float]
    surge_multiplier: Optional[float]


def _snapshot(rule: PricingRule) -> PricingSnapshot:
    return PricingSnapshot(
        base_fare=rule.base_fare,
        per_km=rule.per_km,
        per_minute=rule.per_minute,
        min_fare=rule.min_fare,
        night_multiplier=rule.night_multiplier,
        surge_multiplier=rule.surge_multiplier,
    )


async def get_pricing_rules(
    db_sess: AsyncSession, vehicle_type: str, city: Optional[str] = None
) -> List[PricingSnapshot]:
    key = f"pricing:rules:{vehicle_type}:{city or '*'}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    res = await db_sess.execute(
        select(PricingRule).where(PricingRule.vehicle_type == vehicle_type, PricingRule.active == 1)
    )
    rules = list(res.scalars().all())
    if not rules:
        return []
    if city:
        city_rules = [r for r in rules if r.city == city]
        if city_rules:
            rules = city_rules
        else:
            nationwide = [r for r in rules if r.city is None]
            rules = nationwide or rules
    else:
        nationwide = [r for r in rules if r.city is None]
        rules = nationwide or rules

    snapshots = [_snapshot(r) for r in rules]
    cache.set(key, snapshots, ttl=CACHE_TTL_PRICING)
    return snapshots


def invalidate_pricing_rules() -> None:
    """Drop cached pricing rules after an admin edits them."""
    cache.delete_prefix("pricing:rules:")


async def compute_fare(
    db_sess: AsyncSession,
    vehicle_type: str,
    distance_km: float,
    minutes: int,
    city: Optional[str] = None,
    hour: Optional[int] = None,
) -> float:
    rules = await get_pricing_rules(db_sess, vehicle_type, city)
    if rules:
        rule = rules[0]
        base, per_km, per_min = rule.base_fare, rule.per_km, rule.per_minute
        min_fare = rule.min_fare or 0.0
        night_mult = rule.night_multiplier or 1.0
        surge = rule.surge_multiplier or 1.0
    else:
        base, per_km, per_min = _FALLBACK["base"], _FALLBACK["per_km"], _FALLBACK["per_min"]
        min_fare = _FALLBACK["min_fare"]
        night_mult = surge = 1.0

    if hour is None:
        hour = datetime.now().hour
    night = night_mult if (hour >= 20 or hour < 5) else 1.0

    total = (base + per_km * distance_km + per_min * minutes) * night * surge
    total = max(total, min_fare)
    return round(total, -1)  # round to nearest ₦10


def zone_disallowed(zones: List[ZoneRule], vehicle_type: str) -> Optional[str]:
    """Returns the zone name if `vehicle_type` is disallowed within the pickup zone."""
    for z in zones:
        disallowed = [v.strip() for v in (z.disallowed_vehicle_types or "").split(",") if v.strip()]
        if vehicle_type in disallowed:
            return z.zone_name
    return None
