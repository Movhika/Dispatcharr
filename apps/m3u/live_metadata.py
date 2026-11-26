"""Metadata that import rules and the category editor set on Live TV categories."""

LIVE_METADATA_FIELDS = frozenset({"is_event"})


def validate_live_metadata(payload, *, allow_reset=False):
    """Missing keys keep their value; null resets a key when allowed."""
    if not isinstance(payload, dict):
        raise ValueError("Category metadata must be an object.")
    if set(payload) - LIVE_METADATA_FIELDS:
        raise ValueError("Unsupported Live TV category metadata field.")
    normalized = {}
    for key, value in payload.items():
        if value is None and allow_reset:
            normalized[key] = None
        elif not isinstance(value, bool):
            raise ValueError("Event category must be true or false.")
        else:
            normalized[key] = value
    return normalized


def is_event_category(relation):
    return bool((relation.metadata_defaults or {}).get("is_event"))


def merge_category_metadata(existing, patch):
    """Apply a validated patch; None removes a key, missing keys stay."""
    merged = dict(getattr(existing, "metadata_defaults", None) or {})
    for key, value in patch.items():
        if value is None:
            merged.pop(key, None)
        else:
            merged[key] = value
    return merged
