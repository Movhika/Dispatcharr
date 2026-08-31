"""Shared helpers for VOD naming, metadata, and per-user access."""

import re


def _first_text(*values):
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, (list, tuple)):
            for item in value:
                if isinstance(item, str) and item.strip():
                    return item.strip()
    return None


_CANONICAL_PREFIX_PATTERNS = (
    re.compile(r"^\s*[┃|]\s*[^┃|]{1,20}\s*[┃|]\s*"),
    re.compile(r"^\s*\[[A-Z0-9+._ -]{1,20}\]\s*", re.IGNORECASE),
    re.compile(r"^\s*[A-Z0-9+._]{1,12}\s+-\s+"),
)


def canonical_output_name(name, *, display_name="", year=None):
    """Build a lightweight client title without changing provider editions.

    A manually stored display name always wins. Otherwise only common,
    structurally delimited provider/category prefixes are removed. The raw
    relation name remains untouched for variants output.
    """
    result = _first_text(display_name, name) or ""
    if not _first_text(display_name):
        for pattern in _CANONICAL_PREFIX_PATTERNS:
            cleaned = pattern.sub("", result, count=1).strip()
            if cleaned != result.strip():
                result = cleaned
                break
    if year and not re.search(rf"\({re.escape(str(year))}\)\s*$", result):
        result = f"{result} ({year})"
    return result


def _relation_metadata(relation_or_properties):
    if isinstance(relation_or_properties, dict):
        properties = relation_or_properties
    else:
        properties = getattr(
            relation_or_properties,
            "custom_properties",
            None,
        ) or {}

    if not isinstance(properties, dict):
        return {}, {}, {}

    detailed_info = properties.get("detailed_info") or {}
    basic_data = properties.get("basic_data") or {}
    movie_data = properties.get("movie_data") or {}
    return (
        detailed_info if isinstance(detailed_info, dict) else {},
        basic_data if isinstance(basic_data, dict) else {},
        movie_data if isinstance(movie_data, dict) else {},
    )


def get_vod_source_name(relation_or_properties, fallback_name):
    """Return the provider-list title retained on a concrete VOD relation."""
    detailed_info, basic_data, movie_data = _relation_metadata(
        relation_or_properties
    )
    return _first_text(
        basic_data.get("name"),
        movie_data.get("name"),
        detailed_info.get("name"),
        detailed_info.get("original_name"),
        detailed_info.get("o_name"),
        basic_data.get("original_name"),
        basic_data.get("o_name"),
        fallback_name,
    )


def get_vod_display_name(content, relation_or_properties=None):
    """Return a clean provider detail title without guessing/removing prefixes."""
    detailed_info, basic_data, movie_data = _relation_metadata(
        relation_or_properties
    )
    content_properties = getattr(content, "custom_properties", None) or {}
    if not isinstance(content_properties, dict):
        content_properties = {}

    return _first_text(
        detailed_info.get("name"),
        detailed_info.get("original_name"),
        detailed_info.get("o_name"),
        movie_data.get("original_name"),
        movie_data.get("o_name"),
        content_properties.get("original_name"),
        content_properties.get("o_name"),
        getattr(content, "name", None),
    )


def get_series_display_name(series, series_relation=None):
    """Prefer a provider's clean detailed title, then the canonical title."""
    detailed_info, basic_data, _movie_data = _relation_metadata(
        series_relation
    )
    series_properties = getattr(series, "custom_properties", None) or {}
    if not isinstance(series_properties, dict):
        series_properties = {}

    return _first_text(
        detailed_info.get("name"),
        detailed_info.get("original_name"),
        detailed_info.get("o_name"),
        basic_data.get("original_name"),
        basic_data.get("o_name"),
        series_properties.get("original_name"),
        series_properties.get("o_name"),
        series.name,
    )

_VOD_MOVIES_ENABLED = "vod_movies_enabled"
_VOD_SERIES_ENABLED = "vod_series_enabled"


def _is_vod_access_enabled(*, prop_key, user=None):
    """Read a VOD access flag from *user*'s custom_properties (default True)."""
    if user is None:
        return True

    props = getattr(user, "custom_properties", None) or {}
    return props.get(prop_key) is not False


def is_vod_movies_enabled(*, user=None):
    """Return whether movies are allowed for *user*.

    Reads ``custom_properties.vod_movies_enabled``, which defaults to True when
    absent so existing users keep their current access. No DB query: the flag
    lives on the already-loaded user row. An anonymous *user* (``None``) is not
    restricted here; callers that can identify a user are the ones that gate.
    """
    return _is_vod_access_enabled(prop_key=_VOD_MOVIES_ENABLED, user=user)


def is_vod_series_enabled(*, user=None):
    """Return whether series and episodes are allowed for *user*.

    Same semantics as :func:`is_vod_movies_enabled`, but for
    ``custom_properties.vod_series_enabled``.
    """
    return _is_vod_access_enabled(prop_key=_VOD_SERIES_ENABLED, user=user)
