"""Source-asset identity and field-level metadata precedence helpers."""

from urllib.parse import urlsplit

from django.db import transaction

from .models import (
    M3UEpisodeRelation,
    M3UMovieRelation,
    M3USeriesRelation,
    M3UVODCategoryRelation,
    VODSourceAsset,
)


RELATION_CONFIG = {
    M3UMovieRelation: (VODSourceAsset.AssetType.MOVIE, "stream_id"),
    M3USeriesRelation: (VODSourceAsset.AssetType.SERIES, "external_series_id"),
    M3UEpisodeRelation: (VODSourceAsset.AssetType.EPISODE, "stream_id"),
}


def provider_origin_key(account):
    """Stable hint only; it never causes automatic cross-account merging."""
    if account.server_group_id:
        return f"server-group:{account.server_group_id}"
    parsed = urlsplit(account.server_url or "")
    host = (parsed.hostname or "").lower()
    port = parsed.port
    return f"host:{host}:{port or ''}" if host else f"account:{account.id}"


@transaction.atomic
def ensure_source_asset(relation):
    relation = relation.__class__.objects.select_for_update().select_related(
        "m3u_account__server_group"
    ).get(pk=relation.pk)
    if relation.source_asset_id:
        return relation.source_asset

    asset_type, id_field = RELATION_CONFIG[type(relation)]
    asset = VODSourceAsset.objects.create(
        asset_type=asset_type,
        provider_origin_key=provider_origin_key(relation.m3u_account),
        provider_asset_id=str(getattr(relation, id_field) or ""),
    )
    relation.source_asset = asset
    relation.save(update_fields=["source_asset"])
    return asset


def category_defaults_for_relation(relation):
    if not relation.category_id:
        return {}
    category_relation = M3UVODCategoryRelation.objects.filter(
        m3u_account=relation.m3u_account,
        category_id=relation.category_id,
    ).only("metadata_defaults").first()
    return category_relation.metadata_defaults if category_relation else {}


def relation_declared_metadata(relation):
    props = relation.custom_properties or {}
    detailed = props.get("detailed_info") or {}
    if not isinstance(detailed, dict):
        detailed = {}
    result = {}
    for key in ("video", "audio", "bitrate", "container_extension"):
        value = detailed.get(key)
        if value not in (None, "", [], {}):
            result[key] = value
    video = result.get("video")
    if isinstance(video, dict):
        width = video.get("width")
        height = video.get("height")
        if height:
            result["height"] = height
            result["resolution"] = (
                f"{width}x{height}" if width else f"{height}p"
            )
    audio = result.get("audio")
    if isinstance(audio, dict):
        tags = audio.get("tags") if isinstance(audio.get("tags"), dict) else {}
        language = audio.get("language") or audio.get("lang") or tags.get("language")
        if language:
            result["audio_languages"] = [language]
    subtitles = detailed.get("subtitles") or detailed.get("subtitle")
    if isinstance(subtitles, dict):
        subtitles = [subtitles]
    if isinstance(subtitles, list):
        languages = []
        for subtitle in subtitles:
            if not isinstance(subtitle, dict):
                continue
            tags = subtitle.get("tags") if isinstance(subtitle.get("tags"), dict) else {}
            language = (
                subtitle.get("language")
                or subtitle.get("lang")
                or tags.get("language")
            )
            if language:
                languages.append(language)
        if languages:
            result["subtitle_languages"] = languages
    return result


def effective_relation_metadata(relation):
    asset = relation.source_asset or ensure_source_asset(relation)
    return asset.effective_metadata(
        category_defaults=category_defaults_for_relation(relation),
        relation_declared=relation_declared_metadata(relation),
    )
