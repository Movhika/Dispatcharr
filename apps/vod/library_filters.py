"""Database-side Library filters using the source metadata precedence."""

from datetime import timedelta

from django.db.models import (
    Case,
    CharField,
    F,
    JSONField,
    OuterRef,
    Q,
    Subquery,
    Value,
    When,
)
from django.db.models.fields.json import KeyTransform, KeyTextTransform
from django.utils import timezone

from .models import M3UVODCategoryRelation

TECHNICAL_FILTERS = {
    "audio_language": "audio_languages",
    "subtitle_language": "subtitle_languages",
    "resolution": "resolution",
    "video_feature": "video_features",
}


def metadata_value(field):
    cases = []
    for path in (
        "manual_metadata",
        "observed_metadata",
        "declared_metadata",
        "custom_properties__detailed_info",
        "custom_properties__basic_data",
        "custom_properties__info",
    ):
        present = Q(**{f"{path}__has_key": field}) & ~Q(**{f"{path}__{field}": None})
        cases.append(When(present, then=KeyTransform(field, F(path))))
    category = M3UVODCategoryRelation.objects.filter(
        m3u_account_id=OuterRef("m3u_account_id"),
        category_id=OuterRef("category_id"),
    ).values(f"metadata_defaults__{field}")[:1]
    return Case(*cases, default=Subquery(category), output_field=JSONField())


def technical_values(queryset):
    return queryset.annotate(
        **{
            f"_library_{field}": metadata_value(field)
            for field in TECHNICAL_FILTERS.values()
        }
    )


def filter_relations(queryset, kind, filters):
    for parameter, field in TECHNICAL_FILTERS.items():
        value = filters.get(parameter)
        if not value:
            continue
        name = f"_library_{field}"
        queryset = queryset.annotate(**{name: metadata_value(field)})
        queryset = queryset.filter(
            **{
                name if field == "resolution" else f"{name}__contains": (
                    value if field == "resolution" else [value]
                )
            }
        )
    if filters.get("container_extension"):
        queryset = (
            queryset.filter(container_extension__iexact=filters["container_extension"])
            if kind == "movie"
            else queryset.none()
        )
    if filters.get("genre"):
        field = f"{kind}__tmdb_metadata"
        queryset = queryset.filter(
            Q(**{f"{field}__genres__icontains": filters["genre"]})
            | (
                ~Q(**{f"{field}__has_key": "genres"})
                & Q(**{f"{kind}__genre__icontains": filters["genre"]})
            )
        )
    if filters.get("anime_mode"):
        anime = Q(**{f"{kind}__tmdb_metadata__is_anime": True}) & Q(
            **{f"{kind}__tmdb_metadata__is_anime__isnull": False}
        )
        queryset = queryset.filter(anime if filters["anime_mode"] == "only" else ~anime)
    if filters.get("adult_mode"):
        adult = Q(**{f"{kind}__tmdb_metadata__adult": True}) & Q(
            **{f"{kind}__tmdb_metadata__adult__isnull": False}
        )
        if kind == "movie":
            adult |= Q(movie__is_adult=True)
        queryset = queryset.filter(adult if filters["adult_mode"] == "only" else ~adult)
    if filters.get("added_after_days"):
        queryset = queryset.filter(
            **{
                f"{kind}__library_added_at__gte": timezone.now()
                - timedelta(days=filters["added_after_days"])
            }
        )
    if filters.get("added_since"):
        queryset = queryset.filter(
            **{f"{kind}__library_added_at__date__gte": filters["added_since"]}
        )
    if filters.get("added_until"):
        queryset = queryset.filter(
            **{f"{kind}__library_added_at__date__lte": filters["added_until"]}
        )
    if filters.get("released_since") or filters.get("released_until"):
        queryset = queryset.annotate(
            _library_release_date=Case(
                When(
                    Q(**{f"{kind}__tmdb_metadata__has_key": "release_date"}),
                    then=KeyTextTransform("release_date", F(f"{kind}__tmdb_metadata")),
                ),
                default=KeyTextTransform(
                    "release_date", F(f"{kind}__custom_properties")
                ),
                output_field=CharField(),
            )
        ).filter(_library_release_date__regex=r"^\d{4}-\d{2}-\d{2}$")
        for parameter, lookup in (("released_since", "gte"), ("released_until", "lte")):
            if filters.get(parameter):
                queryset = queryset.filter(
                    **{f"_library_release_date__{lookup}": str(filters[parameter])}
                )
    return queryset


def available_values(querysets):
    """Read actual source values once, without N+1 category lookups."""
    values = {field: set() for field in TECHNICAL_FILTERS.values()}
    values.update(container_extensions=set(), genres=set())
    for kind, queryset in querysets:
        fields = [f"_library_{field}" for field in TECHNICAL_FILTERS.values()]
        rows = (
            technical_values(queryset)
            .annotate(
                _library_container=(
                    F("container_extension")
                    if kind == "movie"
                    else Value("", output_field=CharField())
                ),
                _library_genre=F(f"{kind}__genre"),
                _library_genres=KeyTransform("genres", F(f"{kind}__tmdb_metadata")),
            )
            .values(*fields, "_library_container", "_library_genre", "_library_genres")
        )
        for row in rows.iterator(chunk_size=1000):
            for field in TECHNICAL_FILTERS.values():
                value = row[f"_library_{field}"]
                items = (
                    [value]
                    if field == "resolution"
                    else value if isinstance(value, list) else []
                )
                values[field].update(
                    item for item in items if isinstance(item, str) and item
                )
            if row["_library_container"]:
                values["container_extensions"].add(row["_library_container"].lower())
            genres = row["_library_genres"]
            if isinstance(genres, list):
                values["genres"].update(
                    item["name"]
                    for item in genres
                    if isinstance(item, dict) and item.get("name")
                )
            elif row["_library_genre"]:
                values["genres"].update(
                    part.strip()
                    for part in row["_library_genre"].split(",")
                    if part.strip()
                )
    return {field: sorted(items, key=str.casefold) for field, items in values.items()}
