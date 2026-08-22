"""Versioned XC VOD catalog cache helpers."""

import hashlib
import logging
import time

from django.core.cache import cache

GENERATION_KEY = "xc_vod_catalog:generation"
logger = logging.getLogger(__name__)
_fallback_generation = str(time.time_ns())


def safe_cache_get(key, default=None):
    try:
        return cache.get(key, default)
    except Exception as exc:
        logger.warning("VOD cache read failed for %s: %s", key, exc)
        return default


def safe_cache_set(key, value, timeout=None):
    try:
        cache.set(key, value, timeout=timeout)
        return True
    except Exception as exc:
        logger.warning("VOD cache write failed for %s: %s", key, exc)
        return False


def catalog_generation():
    generation = safe_cache_get(GENERATION_KEY)
    if generation is None:
        generation = str(time.time_ns())
        try:
            cache.add(GENERATION_KEY, generation, timeout=None)
        except Exception:
            return _fallback_generation
        generation = safe_cache_get(GENERATION_KEY, generation)
    return generation


def bump_catalog_generation():
    global _fallback_generation
    generation = str(time.time_ns())
    _fallback_generation = generation
    safe_cache_set(GENERATION_KEY, generation, timeout=None)
    return generation


def catalog_cache_key(request, user, action, category_id=None):
    policy = getattr(user, "_vod_access_policy", None)
    policy_marker = (
        f"{policy.id}:{policy.updated_at.timestamp()}" if policy else "legacy"
    )
    visibility = "adult-hidden" if (
        getattr(user, "user_level", 0) < 10
        and (getattr(user, "custom_properties", None) or {}).get(
            "hide_adult_content", False
        )
    ) else "all"
    host = request.get_host() if request else ""
    digest = hashlib.sha256(
        f"{host}|{user.id}|{policy_marker}|{visibility}|{category_id or ''}".encode()
    ).hexdigest()[:24]
    return f"xc_vod_catalog:{catalog_generation()}:{action}:{digest}"
