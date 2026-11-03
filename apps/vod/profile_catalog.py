"""Prepared VOD profile catalogues for Xtream Codes output.

A build decides, per profile, which source represents each title (or each
edition or variant), reserves its stable public ID and stores the ordered
fallback sources. Requests then read one generation instead of ranking every
source again. Titles, artwork and blocks stay live at output time.
"""

import hashlib
import json
import re
import uuid
from collections import Counter
from types import SimpleNamespace

from django.core.cache import cache
from django.db import transaction
from django.db.models import Count, Q
from django.db.models.functions import Lower
from django.utils import timezone

from .metadata import (
    effective_source_metadata,
    legacy_category_metadata,
    metadata_satisfies,
    requirements_from_metadata,
)
from .models import (
    M3UMovieRelation,
    M3USeriesRelation,
    M3UVODCategoryRelation,
    Movie,
    Series,
    VODContentAlias,
    VODList,
    VODListItem,
    VODProfile,
    VODProfileEntry,
)
from .references import (
    edition_key,
    edition_references,
    output_references,
    reference_kind,
    selection_key,
    source_references,
)

BATCH_SIZE = 2000
QUEUE_KEY = "vod-profile-catalogs-queued"
CONTENT = {"movie": (Movie, M3UMovieRelation), "series": (Series, M3USeriesRelation)}
SIGNATURE_FIELDS = (
    "output_mode",
    "category_choices",
    "content_filters",
    "excluded_titles",
    "edition_rules",
    "ranking",
    "audio_language_order",
    "subtitle_language_order",
    "provider_order",
)


def catalog_signature(profile):
    """Fingerprint of every setting that changes which sources a profile offers."""
    config = {field: getattr(profile, field) for field in SIGNATURE_FIELDS}
    config["category_rules"] = (
        list(
            profile.category_rules.values_list(
                "scope", "regex_pattern", "action", "case_sensitive", "enabled", "order"
            )
        )
        if profile.pk
        else []
    )
    if profile.output_groups == VODProfile.OutputGroups.LISTS:
        from .lists import is_visible, profile_list_ids

        ids = profile_list_ids(profile)
        found = VODList.objects.in_bulk(ids)
        config["lists"] = {
            "unsorted": profile.include_unsorted,
            "lists": [
                (
                    pk,
                    found[pk].content_type,
                    is_visible(found[pk]),
                    (found[pk].build_counts or {}).get("signature", ""),
                )
                for pk in ids
                if pk in found
            ],
        }
    return hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()


def request_catalog_build(profile_ids=None, countdown=30):
    """Debounce rebuilds: one queued run covers every request until it starts."""
    from .tasks import build_vod_profile_catalogs

    key = QUEUE_KEY
    if profile_ids is not None:
        key = f"{QUEUE_KEY}:{','.join(str(pk) for pk in sorted(profile_ids))}"
    if cache.add(key, True, timeout=countdown + 600):
        transaction.on_commit(
            lambda: build_vod_profile_catalogs.apply_async(
                args=[profile_ids, key], countdown=countdown
            )
        )


def refresh_catalog(profile, *, force=False):
    """Queue a rebuild when saved settings change what an active profile offers."""
    if not profile.is_active or (
        not force and catalog_signature(profile) == profile.catalog_signature
    ):
        return
    # A running build notices the change itself and stays pending.
    if profile.catalog_status != VODProfile.CatalogStatus.BUILDING:
        profile.catalog_status = VODProfile.CatalogStatus.PENDING
        profile.save(update_fields=["catalog_status"])
    request_catalog_build([profile.pk], countdown=5)


def output_generation(profile):
    """The generation clients see; None keeps live output for an unbuilt default."""
    if profile.catalog_status == VODProfile.CatalogStatus.PENDING:
        request_catalog_build([profile.pk], countdown=5)
    if profile.catalog_generation:
        return profile.catalog_generation
    return None if profile.is_default else ""


def catalog_entries(profile, generation, content_type):
    return VODProfileEntry.objects.filter(
        profile=profile, generation=generation, content_type=content_type
    )


def profile_source_order(
    user, content_type, content, identifier=None, *, by_uuid=False
):
    """Ordered source IDs a user's profile offers for a title.

    None means unrestricted (live default output); an empty list means the
    profile does not offer the title. Episodes follow their series sources.
    """
    from .profiles import profile_for_user

    profile = profile_for_user(user)
    generation = output_generation(profile)
    if generation is None:
        return None
    kind = "series" if content_type in ("series", "episode") else "movie"
    target = content.series_id if content_type == "episode" else content.pk
    entries = list(
        catalog_entries(profile, generation, kind)
        .filter(content_id=target)
        .order_by("-primary", "pk")
        .values_list("public_id", "source_ids")
    )
    if content_type == "episode":
        public_id, pinned = _episode_series_id(content, identifier, by_uuid)
        if pinned is not None:
            # A Sources entry's episode plays only that entry's source.
            offered = {source for _pk, ids in entries for source in ids}
            return [pinned] if pinned in offered else []
    else:
        public_id = _public_id(content_type, content, identifier, by_uuid)
    chosen = [ids for pk, ids in entries if pk == public_id] or [
        ids for _pk, ids in entries
    ]
    return list(dict.fromkeys(source for ids in chosen for source in ids))


def profile_edition(profile, content_type, content, identifier):
    """Edition of the profile entry a client ID names; "" for none."""
    generation = output_generation(profile)
    if not generation:
        return ""
    return (
        catalog_entries(profile, generation, content_type)
        .filter(
            content_id=content.pk,
            public_id=_public_id(content_type, content, identifier, False),
        )
        .values_list("edition", flat=True)
        .first()
        or ""
    )


def _episode_series_id(episode, identifier, by_uuid):
    """Public series ID an episode ID belongs to, or the pinned series source.

    An episode's own ID belongs to its series' own ID, an edition's episode ID
    to that edition of the series. Version IDs return None: they offer every
    entry of the series and keep their version by their requirements.
    """
    from .models import M3UEpisodeRelation

    if identifier is None:
        return None, None
    if str(identifier) == str(episode.uuid if by_uuid else episode.pk):
        return episode.series_id, None
    alias = VODContentAlias.objects.filter(
        content_type="episode",
        **{"legacy_uuid" if by_uuid else "legacy_id": identifier},
    ).first()
    if alias is None:
        return None, None
    kind, value = reference_kind(alias.selection_key)
    if kind == "source":
        return None, (
            M3UEpisodeRelation.objects.filter(pk=value)
            .values_list("series_relation_id", flat=True)
            .first()
        )
    if kind == "edition":
        return (
            VODContentAlias.objects.filter(
                selection_key=edition_key("series", episode.series_id, value)
            )
            .values_list("legacy_id", flat=True)
            .first()
        ), None
    return None, None


def _public_id(content_type, content, identifier, by_uuid):
    if identifier is None:
        return None
    if not by_uuid:
        try:
            return int(identifier)
        except (TypeError, ValueError):
            return None
    if str(content.uuid) == str(identifier):
        return content.pk
    return (
        VODContentAlias.objects.filter(
            content_type=content_type, legacy_uuid=identifier
        )
        .values_list("legacy_id", flat=True)
        .first()
    )


def order_sources(relations, order, key=lambda relation: relation.id):
    """Keep the sources a profile offers, in the profile's order."""
    if order is None:
        return relations
    rank = {source: index for index, source in enumerate(order)}
    return sorted(
        (relation for relation in relations if key(relation) in rank),
        key=lambda relation: rank[key(relation)],
    )


def resolution_height(value):
    text = str(value or "").lower()
    if text == "sd":
        return 480
    match = re.fullmatch(r"(\d{3,4})p", text)
    return int(match.group(1)) if match else 0


def build_catalog(profile):
    """Build a new generation and switch to it; the old one serves until then."""
    generation = uuid.uuid4().hex
    signature = catalog_signature(profile)
    VODProfile.objects.filter(pk=profile.pk).update(
        catalog_status=VODProfile.CatalogStatus.BUILDING,
        catalog_started_at=timezone.now(),
        catalog_progress={},
        catalog_error="",
    )
    try:
        counts = {
            content_type: _build_content(profile, generation, content_type)
            for content_type in CONTENT
        }
    except Exception as error:
        VODProfileEntry.objects.filter(profile=profile, generation=generation).delete()
        VODProfile.objects.filter(pk=profile.pk).update(
            catalog_status=VODProfile.CatalogStatus.FAILED,
            catalog_completed_at=timezone.now(),
            catalog_progress={},
            catalog_error=str(error)[:500],
        )
        raise
    with transaction.atomic():
        current = VODProfile.objects.select_for_update().filter(pk=profile.pk).first()
        if current is None:
            return None
        current.catalog_generation = generation
        current.catalog_signature = signature
        current.catalog_counts = counts
        current.catalog_progress = {}
        current.catalog_completed_at = timezone.now()
        # Settings saved during the build need another run.
        current.catalog_status = (
            VODProfile.CatalogStatus.READY
            if catalog_signature(current) == signature
            else VODProfile.CatalogStatus.PENDING
        )
        current.save(
            update_fields=[
                "catalog_generation",
                "catalog_signature",
                "catalog_counts",
                "catalog_progress",
                "catalog_completed_at",
                "catalog_status",
            ]
        )
    VODProfileEntry.objects.filter(profile=profile).exclude(
        generation=generation
    ).delete()
    return counts


def _build_content(profile, generation, content_type):
    select = _title_selector(profile, content_type)
    pending, titles, entries = [], 0, 0
    editions = Counter()
    for content_id, sources in _source_groups(content_type):
        selected, _reason = select(content_id, sources)
        if not selected:
            continue
        titles += 1
        editions.update({entry[2] for entry in selected})
        # Entries a client gets in full lists, without per-category extras.
        entries += sum(1 for entry in selected if entry[5])
        pending.extend(selected)
        if len(pending) >= BATCH_SIZE:
            _write(profile, generation, content_type, pending)
            pending = []
            VODProfile.objects.filter(pk=profile.pk).update(
                catalog_progress={"content_type": content_type, "titles": titles}
            )
    if pending:
        _write(profile, generation, content_type, pending)
    # Titles per edition, "" for entries without one.
    return {"titles": titles, "entries": entries, "editions": dict(editions)}


EDITION_COUNT_SECONDS = 120


def edition_counts(profile):
    """Offered titles per edition of unsaved settings, counted like a build.

    Loading every source is the slow part, so counts are cached briefly.
    """
    key = f"vod-profile-editions:{catalog_signature(profile)}"
    counts = cache.get(key)
    if counts is None:
        counts = {}
        for content_type in CONTENT:
            select = _title_selector(profile, content_type)
            editions = Counter()
            for content_id, sources in _source_groups(content_type):
                selected, _reason = select(content_id, sources)
                editions.update({entry[2] for entry in selected})
            counts[content_type] = dict(editions)
        cache.set(key, counts, EDITION_COUNT_SECONDS)
    return counts


def _title_selector(profile, content_type, *, explain=False):
    """Return select(content ID, sources) -> (entries, reason it is not offered).

    With explain, select also returns why each left-out source was skipped.
    """
    allowed_category = _category_gate(profile, content_type)
    passes = _source_filter(profile.content_filters)
    excluded = _excluded_content(content_type, profile.content_filters)
    left_out = {
        title["id"]
        for title in profile.excluded_titles
        if title["content_type"] == content_type
    }
    rank = _ranker(profile)
    variants = profile.output_mode == VODProfile.OutputMode.VARIANTS
    # Sources entries list every source; editions only shape Compact entries.
    edition_of = _edition_matcher([] if variants else profile.edition_rules)
    lists = None
    if profile.output_groups == VODProfile.OutputGroups.LISTS:
        from .lists import profile_memberships

        lists = profile_memberships(profile, content_type)

    def assess(content_id, sources):
        if content_id in left_out:
            return [], "excluded", {}
        if content_id in excluded:
            return [], "title", {}
        skipped = {}
        eligible = []
        for source in sources:
            if not allowed_category(source.m3u_account_id, source.category_id):
                skipped[source.id] = "category"
            elif not passes(source.metadata):
                skipped[source.id] = "source"
            else:
                eligible.append(source)
        if not eligible:
            reason = (
                "category"
                if all(item == "category" for item in skipped.values())
                else "source"
            )
            return [], reason, skipped
        eligible.sort(key=rank)
        if lists is not None:
            entries = _list_entries(
                content_id,
                eligible,
                variants,
                edition_of,
                lists,
                profile.include_unsorted,
            )
            return entries, "" if entries else "list", skipped
        return (
            _content_entries(content_id, eligible, variants, edition_of),
            "",
            skipped,
        )

    if explain:
        return assess
    return lambda content_id, sources: assess(content_id, sources)[:2]


PREVIEW_REASONS = {
    "excluded": "Excluded from this profile.",
    "title": "Excluded by the title filters.",
    "category": "None of its categories is enabled in this profile.",
    "source": "No source matches the content filters.",
    "list": "Not in any of the profile's lists.",
}
SOURCE_REASONS = {
    "category": "Category disabled in this profile.",
    "source": "Does not match the content filters.",
}


def preview(
    profile,
    content_type,
    *,
    search="",
    excluded=False,
    account=None,
    category=None,
    edition=None,
    page=1,
    page_size=50,
):
    """Show the titles of a profile's built catalogue, or the ones it excludes.

    The catalogue decides which titles are offered and in which editions, so
    the database filters, counts and pages them; only the shown titles are
    assessed to explain their sources. Titles excluded since the build are
    left out right away. An edition name, or "" for entries without one,
    narrows them to the titles with such an entry.
    """
    from apps.m3u.models import M3UAccount

    from .library import library_settings
    from .models import VODCategory
    from .presentation import canonical_title_search
    from .profiles import (
        GROUP_CATEGORY_NAMES,
        group_category,
        profile_output_name,
        profile_title_expression,
    )

    model, relation_model = CONTENT[content_type]
    languages = library_settings()["languages"]
    group = group_category(profile, content_type) and GROUP_CATEGORY_NAMES[content_type]
    relations = relation_model.objects.filter(m3u_account__is_active=True)
    if account:
        relations = relations.filter(m3u_account_id=account)
    lists = profile.output_groups == VODProfile.OutputGroups.LISTS
    # Grouped output has one client category, which holds every title.
    if category and not group and not lists:
        relations = relations.filter(category_id=category)
    titles = model.objects.filter(
        library_blocked=False, pk__in=relations.values(f"{content_type}_id")
    )
    if category and lists:
        titles = _list_category_titles(profile, content_type, titles, category)
    if search:
        titles = titles.filter(canonical_title_search("", languages, search))
    left_out = [
        title["id"]
        for title in profile.excluded_titles
        if title["content_type"] == content_type
    ]
    editions = {}
    if excluded:
        titles = titles.filter(pk__in=left_out)
    else:
        built = VODProfileEntry.objects.filter(
            profile=profile,
            generation=profile.catalog_generation,
            content_type=content_type,
        ).order_by()
        titles = titles.filter(pk__in=built.values("content_id")).exclude(
            pk__in=left_out
        )
        editions = dict(
            built.filter(content_id__in=titles.values("pk"))
            .values_list("edition")
            .annotate(titles=Count("content_id", distinct=True))
        )
        if edition is not None:
            titles = titles.filter(
                pk__in=built.filter(edition=edition).values("content_id")
            )
    rows = (
        titles.annotate(_title=profile_title_expression("", profile))
        .order_by(Lower("_title"), "pk")
        .values_list("pk", "_title", "year")
    )
    assess = _title_selector(profile, content_type, explain=True)
    start = (page - 1) * page_size
    count, rows = rows.count(), list(rows[start : start + page_size])

    groups = dict(_source_groups(content_type, [row[0] for row in rows]))
    providers = dict(M3UAccount.objects.values_list("id", "name"))
    list_names = _list_namer(profile)
    categories = dict(
        VODCategory.objects.filter(
            pk__in={
                source.category_id
                for sources in groups.values()
                for source in sources
            }
        ).values_list("id", "name")
    )
    results = []
    for content_id, title, year in rows:
        sources = groups.get(content_id, [])
        by_id = {source.id: source for source in sources}
        entries, reason, skipped = assess(content_id, sources)

        def name(source, edition):
            return profile_output_name(
                profile,
                title,
                source.metadata,
                year=year,
                edition=edition,
                provider=providers.get(source.m3u_account_id, ""),
                extension=source.extension,
            )

        offered = [entry for entry in entries if entry[5]]
        roles = {}
        for _id, relation_id, edition, _req, fallbacks, *_flags in offered:
            entry_name = name(by_id[relation_id], edition)
            for position, source_id in enumerate(fallbacks):
                roles.setdefault(source_id, (entry_name, position))
        results.append(
            {
                "id": content_id,
                "title": title,
                "year": year,
                "reason": PREVIEW_REASONS.get(reason, ""),
                "excluded": reason == "excluded",
                "entries": [
                    {
                        "name": name(by_id[relation_id], edition),
                        "source_id": relation_id,
                        "edition": edition,
                        "provider": providers.get(
                            by_id[relation_id].m3u_account_id, ""
                        ),
                        "category": group
                        or list_names(list_ids)
                        or categories.get(by_id[relation_id].category_id, ""),
                        "fallbacks": fallbacks,
                        "metadata": by_id[relation_id].metadata,
                        "sources": len(fallbacks),
                    }
                    for _id, relation_id, edition, _req, fallbacks, _primary, list_ids in (
                        offered
                    )
                ],
                "sources": [
                    {
                        "id": source.id,
                        "provider": providers.get(source.m3u_account_id, ""),
                        "category": categories.get(source.category_id, ""),
                        "metadata": source.metadata,
                        "entry": roles.get(source.id, ("", 0))[0],
                        "state": (
                            ("selected" if roles[source.id][1] == 0 else "fallback")
                            if source.id in roles
                            else "skipped" if source.id in skipped else "unused"
                        ),
                        "reason": SOURCE_REASONS.get(skipped.get(source.id), ""),
                    }
                    for source in sources
                ],
            }
        )
    return {
        "count": count,
        "results": results,
        "categories": preview_categories(profile, content_type, account),
        "accounts": preview_accounts(profile, content_type),
        "editions": editions,
    }


def _source_groups(content_type, content_ids=None):
    """Yield (content ID, sources) with each source's effective metadata."""
    _model, relation_model = CONTENT[content_type]
    defaults = {
        (row.m3u_account_id, row.category_id): {
            **legacy_category_metadata(row.custom_properties),
            **(row.metadata_defaults or {}),
        }
        for row in M3UVODCategoryRelation.objects.only(
            "m3u_account_id", "category_id", "custom_properties", "metadata_defaults"
        )
    }
    relations = relation_model.objects.filter(
        m3u_account__is_active=True,
        **{f"{content_type}__library_blocked": False},
    )
    if content_ids is not None:
        relations = relations.filter(**{f"{content_type}_id__in": content_ids})
    fields = [
        "id",
        f"{content_type}_id",
        "category_id",
        "m3u_account_id",
        "m3u_account__priority",
        "declared_metadata",
        "observed_metadata",
        "manual_metadata",
    ]
    if content_type == "movie":
        fields.append("container_extension")
    rows = (
        relations.order_by(f"{content_type}_id", "id")
        .values_list(*fields)
        .iterator(chunk_size=5000)
    )
    current, group = None, []
    for row in rows:
        source = SimpleNamespace(
            id=row[0],
            category_id=row[2],
            m3u_account_id=row[3],
            priority=row[4] or 0,
            custom_properties={},
            declared_metadata=row[5],
            observed_metadata=row[6],
            manual_metadata=row[7],
            extension=row[8] if len(row) > 8 else "",
        )
        # Same lean metadata as the live output, so public IDs stay identical.
        source.metadata = effective_source_metadata(
            source, category_defaults=defaults.get((row[3], row[2]), {})
        )["values"]
        if row[1] != current and group:
            yield current, group
            group = []
        current = row[1]
        group.append(source)
    if group:
        yield current, group


def _category_states(profile, content_type):
    """Yield (account, category, name, enabled): manual choice, else its rules."""
    from .profiles import category_rule_states

    choices = {
        choice["relation"]: choice["enabled"] for choice in profile.category_choices
    }
    for relation, account, category, scope, name, decision in category_rule_states(
        profile
    ):
        if scope == content_type:
            yield account, category, name, choices.get(relation, decision.enabled)


def _category_gate(profile, content_type):
    """Resolve each account category: manual choice, else its import rules."""
    states = {
        (account, category): enabled
        for account, category, _name, enabled in _category_states(
            profile, content_type
        )
    }
    return lambda account, category: states.get((account, category), False)


def _list_category_titles(profile, content_type, titles, category):
    """Titles of one list category of the preview, or of Unsorted."""
    from .lists import category_list_id, profile_lists

    list_id = category_list_id(category)
    if list_id is None:
        return titles.none()
    if list_id:
        items = VODListItem.objects.filter(vod_list_id=list_id)
    else:
        items = VODListItem.objects.filter(
            vod_list__in=profile_lists(profile, content_type)
        )
    members = items.filter(content_type=content_type).values(f"{content_type}_id")
    return (
        titles.filter(pk__in=members) if list_id else titles.exclude(pk__in=members)
    )


def preview_categories(profile, content_type, account=None):
    """The client categories the profile offers, for the preview filter."""
    from .profiles import GROUP_CATEGORY_NAMES, group_category

    group = group_category(profile, content_type)
    if group:
        return [{"value": group, "label": GROUP_CATEGORY_NAMES[content_type]}]
    if profile.output_groups == VODProfile.OutputGroups.LISTS:
        from .lists import (
            UNSORTED_CATEGORY_ID,
            UNSORTED_NAME,
            display_name,
            list_category_id,
            profile_lists,
        )

        return [
            {"value": list_category_id(vod_list.pk), "label": display_name(vod_list)}
            for vod_list in profile_lists(profile, content_type)
        ] + (
            [{"value": UNSORTED_CATEGORY_ID, "label": UNSORTED_NAME}]
            if profile.include_unsorted
            else []
        )
    names = {
        category: name
        for category_account, category, name, enabled in _category_states(
            profile, content_type
        )
        if enabled and (not account or category_account == account)
    }
    return sorted(
        ({"value": pk, "label": name} for pk, name in names.items()),
        key=lambda category: category["label"].lower(),
    )


def preview_accounts(profile, content_type):
    """The accounts with a category the profile offers, for the preview filter."""
    from apps.m3u.models import M3UAccount

    offered = {
        category_account
        for category_account, _category, _name, enabled in _category_states(
            profile, content_type
        )
        if enabled
    }
    return [
        {"value": pk, "label": name}
        for pk, name in M3UAccount.objects.filter(pk__in=offered)
        .order_by("name", "pk")
        .values_list("pk", "name")
    ]


def _source_filter(filters):
    audio = set(filters.get("audio_languages", []))
    subtitles = set(filters.get("subtitle_languages", []))
    minimum = filters.get("resolution_min", 0)
    maximum = filters.get("resolution_max", 0)
    required = set(filters.get("required_features", []))
    excluded = set(filters.get("excluded_features", []))

    def passes(metadata):
        # Unknown metadata fails closed whenever a filter asks for it.
        if audio and not audio & set(metadata.get("audio_languages", [])):
            return False
        if subtitles and not subtitles & set(metadata.get("subtitle_languages", [])):
            return False
        if minimum or maximum:
            height = resolution_height(metadata.get("resolution"))
            if not height or height < minimum or (maximum and height > maximum):
                return False
        features = set(metadata.get("video_features", []))
        return required <= features and not excluded & features

    return passes


def _excluded_content(content_type, filters):
    """Title-level filters matching the Library's genre, adult and anime filters."""
    model, _relation_model = CONTENT[content_type]
    excluded = set()
    genres = filters.get("excluded_genres", [])
    if genres:
        matching = Q()
        for genre in genres:
            matching |= Q(tmdb_metadata__genres__icontains=genre) | (
                ~Q(tmdb_metadata__has_key="genres") & Q(genre__icontains=genre)
            )
        excluded.update(model.objects.filter(matching).values_list("pk", flat=True))
    adult = Q(tmdb_metadata__adult=True)
    if model is Movie:
        adult |= Q(is_adult=True)
    from .library import missing_tmdb_id

    for mode, condition in (
        (filters.get("anime_mode"), Q(tmdb_metadata__is_anime=True)),
        (filters.get("adult_mode"), adult),
        (filters.get("missing_tmdb_mode"), missing_tmdb_id()),
    ):
        if mode == "exclude":
            excluded.update(
                model.objects.filter(condition).values_list("pk", flat=True)
            )
        elif mode == "only":
            excluded.update(
                model.objects.exclude(condition).values_list("pk", flat=True)
            )
    return excluded


def _ranker(profile):
    audio = {code: index for index, code in enumerate(profile.audio_language_order)}
    subtitles = {
        code: index for index, code in enumerate(profile.subtitle_language_order)
    }
    providers = {account: index for index, account in enumerate(profile.provider_order)}

    def language(order, codes):
        return min((order[code] for code in codes if code in order), default=len(order))

    criteria = {
        "audio_language": lambda source: language(
            audio, source.metadata.get("audio_languages", [])
        ),
        "subtitle_language": lambda source: language(
            subtitles, source.metadata.get("subtitle_languages", [])
        ),
        "provider": lambda source: providers.get(source.m3u_account_id, len(providers)),
        "resolution_desc": lambda source: -resolution_height(
            source.metadata.get("resolution")
        ),
        # Unknown resolutions rank last in both directions.
        "resolution_asc": lambda source: resolution_height(
            source.metadata.get("resolution")
        )
        or 100000,
        "metadata_completeness": lambda source: -sum(
            1 for value in source.metadata.values() if value
        ),
    }
    keys = [criteria[name] for name in profile.ranking]
    # Account priority stays the final tie-breaker, as in the live output.
    return lambda source: (
        *(key(source) for key in keys),
        -source.priority,
        source.id,
    )


def _edition_matcher(rules):
    def edition(metadata):
        height = resolution_height(metadata.get("resolution"))
        audio = set(metadata.get("audio_languages", []))
        subtitles = set(metadata.get("subtitle_languages", []))
        features = set(metadata.get("video_features", []))
        for rule in rules:
            if rule["min_resolution"] and height < rule["min_resolution"]:
                continue
            if rule["max_resolution"] and (
                not height or height > rule["max_resolution"]
            ):
                continue
            values = {
                "audio_languages": audio,
                "subtitle_languages": subtitles,
                "video_features": features,
            }
            if all(
                set(rule.get(f"required_{field}", [])) <= found
                and not set(rule.get(f"excluded_{field}", [])) & found
                for field, found in values.items()
            ):
                return rule["title_suffix"]
        return ""

    return edition


def _content_entries(content_id, sources, variants, edition_of):
    """Primary entries plus the best source per category for category requests.

    Sources entries list every provider source on its own, as the provider
    does; each entry plays only its source.

    Compact entries carry no requirements: they list under the title's own ID
    (or its edition's ID) and play the best offered source of their edition,
    falling back to every other one, the same version first. Only a category
    whose best source is a version the edition's best source does not offer
    (e.g. a German category of an English title) gets an entry of that
    version, which plays nothing but that version.
    """
    if variants:
        return [
            (
                content_id,
                source.id,
                "",
                requirements_from_metadata(source.metadata),
                [source.id],
                True,
                [],
            )
            for source in sources
        ]
    editions = {}
    for source in sources:
        editions.setdefault(edition_of(source.metadata), []).append(source)
    entries = [
        (content_id, members[0].id, edition, None, _fallbacks(members), True, [])
        for edition, members in editions.items()
    ]
    primary = {entry[1]: entry for entry in entries}
    by_edition = {entry[2]: entry for entry in entries}
    categories = {}
    for source in sources:
        categories.setdefault(source.category_id, []).append(source)
    if len(categories) > 1:
        for members in categories.values():
            leads = {}
            for source in members:
                leads.setdefault(edition_of(source.metadata), source)
            for edition, lead in leads.items():
                if lead.id in primary:
                    continue
                requirements = requirements_from_metadata(lead.metadata)
                best = editions[edition][0]
                if metadata_satisfies(best.metadata, requirements):
                    # The same version as the edition: same ID, same playback.
                    entries.append(
                        (content_id, lead.id, edition, None, by_edition[edition][4], False, [])
                    )
                    continue
                fallbacks = [lead.id] + [
                    source.id
                    for source in editions[edition]
                    if source.id != lead.id
                    and metadata_satisfies(source.metadata, requirements)
                ]
                entries.append(
                    (content_id, lead.id, edition, requirements, fallbacks, False, [])
                )
    return entries


def _fallbacks(members):
    """Ranked source IDs of an entry, the leading source's version first."""
    requirements = requirements_from_metadata(members[0].metadata)
    return [
        source.id
        for source in sorted(
            members,
            key=lambda source: not metadata_satisfies(source.metadata, requirements),
        )
    ]


def _list_entries(content_id, sources, variants, edition_of, lists, unsorted):
    """Entries of a title with list output, carrying the lists it is in.

    The profile chooses the sources as for any output; titles in none of its
    lists go to Unsorted, if wanted.
    """
    list_ids = lists.get(content_id, [])
    if not list_ids and not unsorted:
        return []
    return [
        (*entry[:6], list_ids)
        for entry in _content_entries(content_id, sources, variants, edition_of)
        if entry[5]
    ]


def _list_namer(profile):
    """Client category names of an entry's lists, for previews."""
    if profile.output_groups != VODProfile.OutputGroups.LISTS:
        return lambda list_ids: ""
    from .lists import UNSORTED_NAME, display_name, profile_list_ids

    names = {
        vod_list.pk: display_name(vod_list)
        for vod_list in VODList.objects.filter(pk__in=profile_list_ids(profile))
    }
    return lambda list_ids: ", ".join(names.get(pk, "") for pk in list_ids) or UNSORTED_NAME


def _write(profile, generation, content_type, pending):
    if profile.output_mode == VODProfile.OutputMode.VARIANTS:
        # Each source keeps its own public ID, like a provider catalogue.
        by_source = source_references(
            content_type,
            [(content_id, relation_id) for content_id, relation_id, *_rest in pending],
        )

        def public_id(content_id, relation_id, requirements, edition):
            return by_source[relation_id].legacy_id

    else:
        editions = edition_references(
            content_type,
            [
                (content_id, edition)
                for content_id, _id, edition, requirements, *_rest in pending
                if requirements is None
            ],
        )
        versions = output_references(
            content_type,
            [
                (content_id, requirements)
                for content_id, _id, _ed, requirements, *_rest in pending
                if requirements is not None
            ],
        )

        def public_id(content_id, relation_id, requirements, edition):
            if requirements is None:
                return editions[(content_id, edition)]
            return versions[
                selection_key(content_type, content_id, requirements)
            ].legacy_id

    VODProfileEntry.objects.bulk_create(
        [
            VODProfileEntry(
                profile=profile,
                generation=generation,
                content_type=content_type,
                content_id=content_id,
                relation_id=relation_id,
                public_id=public_id(content_id, relation_id, requirements, edition),
                edition=edition,
                source_ids=fallbacks,
                primary=primary,
                list_ids=list_ids,
            )
            for content_id, relation_id, edition, requirements, fallbacks, primary, list_ids in (
                pending
            )
        ],
        batch_size=BATCH_SIZE,
    )
