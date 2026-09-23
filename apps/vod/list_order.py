"""Ordering for list previews and list-backed XC categories."""

from django.db.models import CharField, F, Value
from django.db.models.fields.json import KeyTextTransform
from django.db.models.functions import Cast, Coalesce, NullIf


SORT_MODES = {"", "release_date_desc", "library_added_desc"}


def list_sort_mode(vod_list):
    settings = vod_list.settings if isinstance(vod_list.settings, dict) else {}
    mode = str(settings.get("sort_mode") or "")
    return mode if mode in SORT_MODES else ""


def ordered_list_items(vod_list, queryset):
    """Preserve supplied order by default; place unknown dates last."""
    mode = list_sort_mode(vod_list)
    if mode == "release_date_desc":
        release_date = Coalesce(
            NullIf(KeyTextTransform("release_date", "movie__tmdb_metadata"), Value("")),
            NullIf(KeyTextTransform("release_date", "series__tmdb_metadata"), Value("")),
            NullIf(KeyTextTransform("release_date", "metadata"), Value("")),
            Cast("year", CharField()),
            output_field=CharField(),
        )
        return queryset.annotate(_list_release_date=release_date).order_by(
            F("_list_release_date").desc(nulls_last=True), "position", "id"
        )
    if mode == "library_added_desc":
        added_at = Coalesce("movie__library_added_at", "series__library_added_at")
        return queryset.annotate(_list_added_at=added_at).order_by(
            F("_list_added_at").desc(nulls_last=True), "position", "id"
        )
    return queryset.order_by("position", "id")
