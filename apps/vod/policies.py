"""VOD visibility, compact selection and failover-compatible ranking."""

from django.db.models import Q

from .catalog_cache import catalog_generation, safe_cache_get, safe_cache_set
from .models import VODAccessPolicy


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
    safe_cache_set(cache_key, policy or 0, timeout=3600)
    return policy


def policy_category_map(policy):
    if not policy:
        return {}
    return {
        (row.category_relation.m3u_account_id, row.category_relation.category_id): row
        for row in policy.vodpolicycategory_set.filter(
            enabled=True,
            category_relation__enabled=True,
            category_relation__m3u_account__is_active=True,
        ).select_related("category_relation")
    }


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
    query = Q(pk__in=[])
    for account_id, category_id in mapping:
        query |= Q(m3u_account_id=account_id, category_id=category_id)
    return query


def _language_set(value):
    if isinstance(value, str):
        value = [part.strip() for part in value.replace(";", ",").split(",")]
    if not isinstance(value, (list, tuple, set)):
        return set()
    aliases = {
        "de": "deu", "ger": "deu", "german": "deu", "deutsch": "deu",
        "en": "eng", "english": "eng", "englisch": "eng",
    }
    return {
        aliases.get(str(item).strip().lower(), str(item).strip().lower())
        for item in value
        if str(item).strip()
    }


def _height(metadata):
    value = metadata.get("height") or metadata.get("resolution") or metadata.get("quality")
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
    defaults = category_relation.metadata_defaults if category_relation else {}
    from .metadata import relation_declared_metadata

    declared = relation_declared_metadata(relation)
    if relation.source_asset_id:
        return relation.source_asset.effective_metadata(
            category_defaults=defaults,
            relation_declared=declared,
        )["values"]
    return {**(defaults or {}), **declared}


def relation_allowed(relation, policy, category_mapping=None):
    if not policy:
        return True
    category_mapping = category_mapping or policy_category_map(policy)
    category_rule = category_mapping.get(
        (relation.m3u_account_id, relation_category_id(relation))
    )
    if category_rule is None:
        return False

    metadata = relation_metadata(relation, category_rule.category_relation)
    constraints = policy.hard_constraints or {}
    allow_unknown = constraints.get("allow_unknown_metadata", True)

    required_audio = _language_set(constraints.get("required_audio_languages"))
    observed_audio = _language_set(
        metadata.get("audio_languages") or metadata.get("languages")
    )
    if required_audio and not observed_audio and not allow_unknown:
        return False
    if required_audio and observed_audio and required_audio.isdisjoint(observed_audio):
        return False

    required_subtitles = _language_set(
        constraints.get("required_subtitle_languages")
    )
    observed_subtitles = _language_set(metadata.get("subtitle_languages"))
    if required_subtitles and not observed_subtitles and not allow_unknown:
        return False
    if (
        required_subtitles
        and observed_subtitles
        and required_subtitles.isdisjoint(observed_subtitles)
    ):
        return False

    height = _height(metadata)
    min_height = _constraint_int(constraints, "min_height")
    max_height = _constraint_int(constraints, "max_height")
    if min_height and not height and not allow_unknown:
        return False
    if min_height and height and height < min_height:
        return False
    if max_height and height and height > max_height:
        return False
    return True


def relation_rank(relation, category_mapping, policy=None):
    category_rule = category_mapping.get(
        (relation.m3u_account_id, relation_category_id(relation))
    )
    metadata = relation_metadata(
        relation,
        category_rule.category_relation if category_rule else None,
    )
    manual_preferred = bool(metadata.get("preferred"))
    dimensions = {
        "category_priority": category_rule.priority if category_rule else 0,
        "resolution": _height(metadata),
        "account_priority": relation.m3u_account.priority,
    }
    requested = list((policy.ranking if policy else None) or [])
    order = [
        key
        for key in requested + [
            "category_priority", "resolution", "account_priority"
        ]
        if key in dimensions
    ]
    order = list(dict.fromkeys(order))
    return (
        int(manual_preferred),
        *(dimensions[key] for key in order),
        -relation.id,
    )


def select_relations_for_policy(relations, policy, canonical_field):
    """Select allowed variants or one highest-ranked relation per title."""
    if not policy:
        return list(relations)
    category_mapping = policy_category_map(policy)
    selected = {}
    for relation in relations:
        if not relation_allowed(relation, policy, category_mapping):
            continue
        key = _relation_selection_key(relation, policy, canonical_field)
        rank = relation_rank(relation, category_mapping, policy)
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


def select_relation_ids_for_policy(relations, policy, canonical_field):
    """Stream relations and retain only the winning ID for each output entry.

    This is the cold-cache XC path. Keeping compact winner tuples instead of a
    list of every ORM object prevents large VOD libraries from being duplicated
    in memory while policy constraints and ranking are evaluated.
    """
    if not policy:
        return [relation.id for relation in relations]

    category_mapping = policy_category_map(policy)
    selected = {}
    for relation in relations:
        if not relation_allowed(relation, policy, category_mapping):
            continue
        key = _relation_selection_key(relation, policy, canonical_field)
        rank = relation_rank(relation, category_mapping, policy)
        current = selected.get(key)
        if current is None or rank > current[0]:
            selected[key] = (rank, relation.id)

    return [entry[1] for entry in selected.values()]


def ordered_failover_candidates(candidates, policy):
    """Apply the same hard constraints and ranking used by Compact output."""
    if not policy:
        return list(candidates)
    category_mapping = policy_category_map(policy)
    eligible = [
        relation
        for relation in candidates
        if relation_allowed(relation, policy, category_mapping)
    ]
    return sorted(
        eligible,
        key=lambda relation: relation_rank(relation, category_mapping, policy),
        reverse=True,
    )


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
