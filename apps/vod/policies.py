"""VOD visibility, compact selection and failover-compatible ranking."""

from django.db.models import Q

from .catalog_cache import catalog_generation, safe_cache_get, safe_cache_set
from .metadata import (
    compatible_video_features,
    normalize_bitrate_kbps,
    normalize_language_list,
    normalize_video_features,
)
from .models import M3UVODCategoryRelation, VODAccessPolicy


def policy_for_user(user):
    if not user or not getattr(user, "is_authenticated", False):
        return None
    cache_key = f"vod_policy_user:{catalog_generation()}:{user.pk}"
    cached = safe_cache_get(cache_key)
    if cached == 0:
        return None
    if isinstance(cached, VODAccessPolicy):
        return cached
    assigned = user.vod_access_policies.filter(is_active=True).order_by("id").first()
    if assigned:
        safe_cache_set(cache_key, assigned, timeout=3600)
        return assigned
    policy = VODAccessPolicy.objects.filter(
        is_active=True, is_default=True
    ).order_by("id").first()
    if policy and not M3UVODCategoryRelation.objects.filter(
        enabled=True,
        m3u_account__is_active=True,
    ).exists():
        # The source-management migration can precede the first provider
        # refresh that creates category inventory. Keep unassigned users on
        # the original narrow DISTINCT ON output until the default profile has
        # real source boundaries to work with. Explicit assignments above are
        # intentional and therefore take effect immediately.
        policy = None
    safe_cache_set(cache_key, policy or 0, timeout=3600)
    return policy


def enabled_category_map():
    """Global source availability and category defaults, independent of users."""
    cache_key = f"vod_enabled_categories:{catalog_generation()}"
    cached = safe_cache_get(cache_key)
    if isinstance(cached, dict):
        return cached
    mapping = {
        (account_id, category_id): metadata_defaults or {}
        for account_id, category_id, metadata_defaults in (
            M3UVODCategoryRelation.objects.filter(
                enabled=True,
                m3u_account__is_active=True,
            ).values_list("m3u_account_id", "category_id", "metadata_defaults")
        )
    }
    safe_cache_set(cache_key, mapping, timeout=3600)
    return mapping


def policy_category_map(policy):
    """Return globally enabled sources narrowed by an optional user allowlist.

    An empty allowlist deliberately means "all enabled categories" so existing
    users keep their current catalog.  Category priority is not used for
    ranking; the allowlist is only a hard source boundary before technical
    language/resolution policy is evaluated.
    """
    mapping = enabled_category_map()
    if not policy:
        return mapping
    allowed = set(
        policy.vodpolicycategory_set.filter(enabled=True).values_list(
            "category_relation__m3u_account_id",
            "category_relation__category_id",
        )
    )
    if not allowed:
        return mapping
    return {key: value for key, value in mapping.items() if key in allowed}


def relation_category_id(relation):
    """Return the provider-category ID for movie, series, or episode relations."""
    if hasattr(relation, "category_id"):
        return relation.category_id
    series_relation = getattr(relation, "series_relation", None)
    return getattr(series_relation, "category_id", None)


def relation_category(relation):
    if hasattr(relation, "category"):
        return relation.category
    series_relation = getattr(relation, "series_relation", None)
    return getattr(series_relation, "category", None)


def allowed_category_query(policy):
    mapping = policy_category_map(policy)
    # Keep upgraded installations usable between the schema migration and
    # their first VOD refresh. Older catalogs can contain movie/series
    # relations before M3UVODCategoryRelation rows have been discovered.
    # Once category inventory exists, it remains the hard visibility boundary.
    if not mapping:
        return Q()
    query = Q(pk__in=[])
    categories_by_account = {}
    for account_id, category_id in mapping:
        categories_by_account.setdefault(account_id, []).append(category_id)
    for account_id, category_ids in categories_by_account.items():
        query |= Q(m3u_account_id=account_id, category_id__in=category_ids)
    return query


def _language_set(value):
    return set(normalize_language_list(value))


def _vertical_resolution(metadata):
    value = (
        metadata.get("height")
        or metadata.get("resolution")
        or metadata.get("quality")
    )
    if isinstance(value, dict):
        value = value.get("height") or value.get("resolution")
    text = str(value or "").lower()
    for candidate in (4320, 2160, 1440, 1080, 720, 576, 540, 480, 360, 240):
        if str(candidate) in text:
            return candidate
    return 0


def _constraint_int(constraints, key):
    try:
        return max(0, int(constraints.get(key) or 0))
    except (TypeError, ValueError):
        return 0


def relation_metadata(relation, category_relation=None):
    defaults = (
        category_relation
        if isinstance(category_relation, dict)
        else category_relation.metadata_defaults if category_relation else {}
    )
    from .metadata import relation_declared_metadata

    declared = relation_declared_metadata(relation)
    if relation.source_asset_id:
        return relation.source_asset.effective_metadata(
            category_defaults=defaults,
            relation_declared=declared,
        )["values"]
    return {**(defaults or {}), **declared}


_METADATA_NOT_PROVIDED = object()


def relation_allowed(
    relation,
    policy,
    category_mapping=None,
    metadata=_METADATA_NOT_PROVIDED,
):
    if not policy:
        return True
    category_mapping = category_mapping or policy_category_map(policy)
    category_relation = category_mapping.get(
        (relation.m3u_account_id, relation_category_id(relation))
    )
    if category_relation is None and category_mapping:
        return False

    if metadata is _METADATA_NOT_PROVIDED:
        metadata = relation_metadata(relation, category_relation)
    constraints = policy.hard_constraints or {}
    allow_unknown = constraints.get("allow_unknown_metadata", True)

    required_audio = _language_set(constraints.get("required_audio_languages"))
    observed_audio = _language_set(
        metadata.get("audio_languages") or metadata.get("languages")
    )
    required_subtitles = _language_set(
        constraints.get("required_subtitle_languages")
    )
    observed_subtitles = _language_set(metadata.get("subtitle_languages"))
    excluded_audio = _language_set(constraints.get("excluded_audio_languages"))
    excluded_subtitles = _language_set(
        constraints.get("excluded_subtitle_languages")
    )
    if excluded_audio and not excluded_audio.isdisjoint(observed_audio):
        return False
    if excluded_subtitles and not excluded_subtitles.isdisjoint(
        observed_subtitles
    ):
        return False
    language_mode = constraints.get("language_match_mode", "all")
    language_checks = []
    if required_audio:
        language_checks.append(
            None
            if not observed_audio
            else not required_audio.isdisjoint(observed_audio)
        )
    if required_subtitles:
        language_checks.append(
            None
            if not observed_subtitles
            else not required_subtitles.isdisjoint(observed_subtitles)
        )
    if language_checks:
        known_checks = [value for value in language_checks if value is not None]
        if language_mode == "any":
            # A known match is sufficient. A known non-match is not rescued by
            # another unknown field; this prevents ENG audio with unclassified
            # subtitles from leaking into a GER policy.
            if known_checks and not any(known_checks):
                return False
            if not known_checks and not allow_unknown:
                return False
        else:
            if any(value is False for value in language_checks):
                return False
            if (
                any(value is None for value in language_checks)
                and not allow_unknown
            ):
                return False

    resolution = _vertical_resolution(metadata)
    min_resolution = _constraint_int(constraints, "min_resolution")
    max_resolution = _constraint_int(constraints, "max_resolution")
    if min_resolution and not resolution and not allow_unknown:
        return False
    if min_resolution and resolution and resolution < min_resolution:
        return False
    if max_resolution and resolution and resolution > max_resolution:
        return False
    required_features = set(
        normalize_video_features(constraints.get("required_video_features"))
    )
    observed_features = set(normalize_video_features(metadata.get("video_features")))
    excluded_features = set(
        normalize_video_features(constraints.get("excluded_video_features"))
    )
    if excluded_features and not excluded_features.isdisjoint(observed_features):
        return False
    if required_features:
        if not observed_features and not allow_unknown:
            return False
        compatible_required = {
            compatible
            for required in required_features
            for compatible in compatible_video_features(required)
        }
        feature_match = not compatible_required.isdisjoint(observed_features)
        if observed_features and not feature_match:
            return False
    return True


def _preference_score(observed, preferred):
    preferred = normalize_language_list(preferred)
    observed = _language_set(observed)
    if not preferred:
        return 0
    for index, code in enumerate(preferred):
        if code in observed:
            return len(preferred) - index
    return 0


def _metadata_completeness(metadata):
    """Small, deterministic score used only after higher ranking criteria."""
    return sum(
        (
            bool(metadata.get("audio_languages") or metadata.get("languages")),
            bool(metadata.get("subtitle_languages")),
            bool(_vertical_resolution(metadata)),
            bool(metadata.get("container_extension")),
            bool(_bitrate_kbps(metadata)),
            bool(metadata.get("file_size_bytes")),
            bool(metadata.get("video_features")),
        )
    )


def _bitrate_kbps(metadata):
    return normalize_bitrate_kbps(
        metadata.get("bitrate_kbps", metadata.get("bitrate"))
    ) or 0


def relation_rank(
    relation,
    category_mapping,
    policy=None,
    metadata=_METADATA_NOT_PROVIDED,
):
    category_relation = category_mapping.get(
        (relation.m3u_account_id, relation_category_id(relation))
    )
    if metadata is _METADATA_NOT_PROVIDED:
        metadata = relation_metadata(
            relation,
            category_relation,
        )
    constraints = (policy.hard_constraints if policy else None) or {}
    resolution = _vertical_resolution(metadata)
    bitrate = _bitrate_kbps(metadata)
    dimensions = {
        "audio_language": _preference_score(
            metadata.get("audio_languages") or metadata.get("languages"),
            constraints.get("required_audio_languages"),
        ),
        "subtitle_language": _preference_score(
            metadata.get("subtitle_languages"),
            constraints.get("required_subtitle_languages"),
        ),
        # Existing policies used "resolution". Keep it as a high-first alias.
        "resolution": resolution,
        "resolution_desc": resolution,
        # Ranking is sorted descending. Known low resolutions therefore get a
        # higher inverted score, while unknown metadata remains last.
        "resolution_asc": 10000 - resolution if resolution else -1,
        "bitrate_desc": bitrate,
        # A reciprocal keeps every known bitrate ahead of unknown metadata
        # while still preferring a smaller stream for constrained clients.
        "bitrate_asc": 1 / bitrate if bitrate else -1,
        "metadata_completeness": _metadata_completeness(metadata),
    }
    requested = [
        "resolution_desc" if key == "resolution" else key
        for key in list((policy.ranking if policy else None) or [])
    ]
    requested_resolution = next(
        (
            key for key in requested
            if key in {"resolution_desc", "resolution_asc"}
        ),
        None,
    )
    requested_bitrate = next(
        (key for key in requested if key in {"bitrate_desc", "bitrate_asc"}),
        None,
    )
    requested = [
        key for key in requested
        if (
            key not in {"resolution_desc", "resolution_asc"}
            or key == requested_resolution
        )
        and (
            key not in {"bitrate_desc", "bitrate_asc"}
            or key == requested_bitrate
        )
    ]
    allowed_order = [
        "audio_language",
        "subtitle_language",
        requested_resolution or "resolution_desc",
        requested_bitrate or "bitrate_desc",
        "metadata_completeness",
    ]
    order = list(
        dict.fromkeys(
            [key for key in requested + allowed_order if key in dimensions]
        )
    )
    return (
        *(dimensions[key] for key in order),
        relation.m3u_account.priority,
        -relation.id,
    )


def select_relations_for_policy(relations, policy, canonical_field):
    """Select allowed variants or one highest-ranked relation per title."""
    if not policy:
        return list(relations)
    category_mapping = policy_category_map(policy)
    selected = {}
    for relation in relations:
        category_relation = category_mapping.get(
            (relation.m3u_account_id, relation_category_id(relation))
        )
        metadata = relation_metadata(relation, category_relation)
        if not relation_allowed(
            relation,
            policy,
            category_mapping,
            metadata=metadata,
        ):
            continue
        key = _relation_selection_key(relation, policy, canonical_field)
        rank = relation_rank(
            relation,
            category_mapping,
            policy,
            metadata=metadata,
        )
        current = selected.get(key)
        if current is None or rank > current[0]:
            selected[key] = (rank, relation)

    selected_relations = [entry[1] for entry in selected.values()]
    return sorted(
        selected_relations,
        key=lambda relation: (
            str(getattr(relation, canonical_field)),
            tuple(
                -value
                for value in relation_rank(
                    relation, category_mapping, policy
                )[:-1]
            ),
            relation.id,
        ),
    )


def _relation_selection_key(relation, policy, canonical_field):
    if policy.export_mode == VODAccessPolicy.ExportMode.COMPACT:
        return ("canonical", getattr(relation, canonical_field))
    # Confirmed aliases are one edition. Unlinked relations remain distinct,
    # even when raw provider IDs collide across accounts.
    if relation.source_asset_id:
        return ("asset", relation.source_asset_id)
    return ("relation", relation.id)


def select_relation_ids_for_policy(
    relations,
    policy,
    canonical_field,
    stats=None,
    progress_callback=None,
    progress_interval=5000,
):
    """Stream relations and retain only the winning ID for each output entry.

    This is the cold-cache XC path. Keeping compact winner tuples instead of a
    list of every ORM object prevents large VOD libraries from being duplicated
    in memory while policy constraints and ranking are evaluated.
    """
    if not policy:
        relation_ids = [relation.id for relation in relations]
        if stats is not None:
            stats.update(
                candidates=len(relation_ids),
                eligible=len(relation_ids),
                selected=len(relation_ids),
            )
        return relation_ids

    category_mapping = policy_category_map(policy)
    selected = {}
    candidate_count = 0
    eligible_count = 0
    for relation in relations:
        candidate_count += 1
        if (
            progress_callback
            and candidate_count % max(int(progress_interval or 1), 1) == 0
        ):
            progress_callback(candidate_count)
        category_relation = category_mapping.get(
            (relation.m3u_account_id, relation_category_id(relation))
        )
        metadata = relation_metadata(relation, category_relation)
        if not relation_allowed(
            relation,
            policy,
            category_mapping,
            metadata=metadata,
        ):
            continue
        eligible_count += 1
        key = _relation_selection_key(relation, policy, canonical_field)
        rank = relation_rank(
            relation,
            category_mapping,
            policy,
            metadata=metadata,
        )
        current = selected.get(key)
        if current is None or rank > current[0]:
            selected[key] = (rank, relation.id)

    relation_ids = [entry[1] for entry in selected.values()]
    if stats is not None:
        stats.update(
            candidates=candidate_count,
            eligible=eligible_count,
            selected=len(relation_ids),
        )
    return relation_ids


def ordered_failover_candidates(candidates, policy):
    """Apply the same hard constraints and ranking used by Compact output."""
    if not policy:
        return list(candidates)
    category_mapping = policy_category_map(policy)
    ranked = []
    for relation in candidates:
        category_relation = category_mapping.get(
            (relation.m3u_account_id, relation_category_id(relation))
        )
        metadata = relation_metadata(relation, category_relation)
        if not relation_allowed(
            relation,
            policy,
            category_mapping,
            metadata=metadata,
        ):
            continue
        ranked.append(
            (
                relation_rank(
                    relation,
                    category_mapping,
                    policy,
                    metadata=metadata,
                ),
                relation,
            )
        )
    ranked.sort(key=lambda entry: entry[0], reverse=True)
    return [entry[1] for entry in ranked]


def ordered_candidates(candidates, policy, preferred_relation=None):
    """Apply policy constraints/ranking while preserving an allowed exact choice."""
    if not candidates:
        return []
    if not policy:
        ordered = list(candidates)
    else:
        ordered = ordered_failover_candidates(candidates, policy)
    if preferred_relation and any(
        candidate.id == preferred_relation.id for candidate in ordered
    ):
        return [preferred_relation] + [
            candidate
            for candidate in ordered
            if candidate.id != preferred_relation.id
        ]
    return ordered
