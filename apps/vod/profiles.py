"""VOD profile rules: validation and the profile that applies to a user."""

import string

from django.db import transaction

from .metadata import normalize_languages, normalize_resolution, normalize_video_feature
from .models import (
    M3UVODCategoryRelation,
    Movie,
    Series,
    VODProfile,
    VODProfileAssignment,
    VODProfileCategoryRule,
)

RANKING_CRITERIA = (
    "audio_language",
    "subtitle_language",
    "provider",
    "resolution_desc",
    "resolution_asc",
    "metadata_completeness",
)
NAME_PLACEHOLDERS = frozenset(
    {
        "title",
        "year",
        "edition",
        "provider",
        "dub",
        "sub",
        "resolution",
        "format",
        "features",
    }
)
# Compact entries fall back to other sources, so their names only show what
# every source shares.
COMPACT_PLACEHOLDERS = frozenset({"title", "year", "edition"})
CONTENT_MODES = ("", "exclude", "only")
# Title sources besides the Library metadata languages.
PROVIDER_TITLES = "provider"
CLEAN_TITLES = "clean"
# One client category per content type, as the prototype used.
GROUP_CATEGORY_IDS = {"movie": 2_000_000_000, "series": 2_000_000_001}
GROUP_CATEGORY_NAMES = {"movie": "Movies", "series": "Series"}
TITLE_MODELS = {"movie": Movie, "series": Series}
MAX_RULES = 100
MAX_LIST_ITEMS = 50
MAX_TEXT = 120


class FieldError(ValueError):
    """A validation message for one field, optionally of one ordered rule."""

    def __init__(self, field, message, index=None):
        super().__init__(message)
        self.field = field
        self.index = index


def default_profile():
    """Return the default profile, recreating it if an install lost it."""
    profile = VODProfile.objects.filter(is_default=True).first()
    if profile is not None:
        return profile
    with transaction.atomic():
        profile, created = VODProfile.objects.get_or_create(
            is_default=True,
            defaults={"name": _free_name("Default"), "ranking": ["provider"]},
        )
        if created:
            # Like the migration: offer every category the accounts enable.
            VODProfileCategoryRule.objects.bulk_create(
                VODProfileCategoryRule(
                    profile=profile, scope=scope, regex_pattern=".*", action="enable"
                )
                for scope in VODProfileCategoryRule.Scope.values
            )
    return profile


def _free_name(name):
    candidate, index = name, 2
    while VODProfile.objects.filter(name=candidate).exists():
        candidate, index = f"{name} {index}", index + 1
    return candidate


def profile_languages(profile):
    """Title languages: the Library languages, starting with the profile's."""
    from .library import library_settings

    if profile.title_source == CLEAN_TITLES:
        return []
    languages = library_settings()["languages"]
    if profile.title_source not in languages:
        return languages
    return [profile.title_source] + [
        language for language in languages if language != profile.title_source
    ]


def profile_title(profile, content, provider_title):
    """The title clients get, as the provider names it or from the Library."""
    from .presentation import canonical_title

    if profile.title_source == PROVIDER_TITLES:
        return provider_title
    return canonical_title(content, profile_languages(profile))


def profile_title_expression(prefix, profile):
    """profile_title in SQL, with the provider's title stored on the content."""
    from django.db.models import F

    from .presentation import canonical_title_expression

    if profile.title_source == PROVIDER_TITLES:
        return F(f"{prefix}name")
    return canonical_title_expression(prefix, profile_languages(profile))


def library_metadata_language(profile):
    """Language of Library descriptions: the title language, else the first."""
    from .library import library_settings

    languages = library_settings()["languages"]
    return profile.title_source if profile.title_source in languages else languages[0]


def uses_enriched_metadata(profile):
    return profile.metadata_source == VODProfile.MetadataSource.ENRICHED


def group_category(profile, content_type):
    """The single client category of grouped output, else None."""
    if profile.output_groups != VODProfile.OutputGroups.MOVIE_SERIES:
        return None
    return GROUP_CATEGORY_IDS[content_type]


def category_rule_states(profile, rules=None, *, enabled_only=False):
    """Yield (relation, account, category, scope, name, decision) per category.

    The decision comes from the first matching enabled import rule, exactly as
    for M3U imports; categories without a matching rule are disabled.
    """
    from apps.m3u.group_rules import compile_group_rules, evaluate_group_rules

    if rules is None:
        rules = profile.category_rules.all() if profile.pk else []
    rules = sorted(rules, key=lambda rule: (rule.order, str(rule.id)))
    compiled = {
        scope: compile_group_rules([rule for rule in rules if rule.scope == scope])
        for scope in VODProfileCategoryRule.Scope.values
    }
    relations = M3UVODCategoryRelation.objects.filter(
        category__category_type__in=compiled
    )
    if enabled_only:
        relations = relations.filter(enabled=True)
    for relation, account, category, scope, name in (
        relations.order_by("id")
        .values_list(
            "pk",
            "m3u_account_id",
            "category_id",
            "category__category_type",
            "category__name",
        )
    ):
        yield relation, account, category, scope, name, evaluate_group_rules(
            compiled[scope], group_name=name
        )


def profile_for_user(user):
    """An active assigned profile wins; everyone else uses the default."""
    assignment = (
        VODProfileAssignment.objects.select_related("profile")
        .filter(user_id=getattr(user, "pk", None), profile__is_active=True)
        .first()
    )
    return assignment.profile if assignment else default_profile()


def _height(value, field):
    if value in (None, ""):
        return 0
    try:
        height = int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field} must be a pixel height such as 2160.")
    if not 0 <= height <= 20000:
        raise ValueError(f"{field} must be between 0 and 20000.")
    return height


def _text(value, field, *, required=False):
    text = str(value or "").strip()
    if required and not text:
        raise ValueError(f"Enter {field}.")
    if len(text) > MAX_TEXT:
        raise ValueError(f"{field.capitalize()} is too long.")
    return text


def _list(value, field):
    if value in (None, ""):
        return []
    if not isinstance(value, list) or len(value) > MAX_LIST_ITEMS:
        raise ValueError(f"{field.capitalize()} must be a short list.")
    return value


def _features(value, field):
    return list(
        dict.fromkeys(normalize_video_feature(item) for item in _list(value, field))
    )


def _ordered_rules(value, field):
    if not isinstance(value, list):
        raise ValueError(f"{field.capitalize()} must be an ordered list.")
    if len(value) > MAX_RULES:
        raise ValueError(f"Use at most {MAX_RULES} {field}.")
    for rule in value:
        if not isinstance(rule, dict):
            raise ValueError(f"Each {field[:-1]} must be an object.")
    return value


def _rule_id(rule, prefix, index, seen):
    rule_id = str(rule.get("id") or f"{prefix}-{index}")[:120]
    if rule_id in seen:
        raise ValueError("Rule IDs must be unique.")
    seen.add(rule_id)
    return rule_id


def normalize_category_choices(value):
    """Manual on/off choices per account category; they override the rules."""
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        raise ValueError("Category choices must be a list.")
    choices = {}
    for choice in value:
        if not isinstance(choice, dict):
            raise ValueError("Each category choice must be an object.")
        relation = choice.get("relation")
        if isinstance(relation, bool) or not isinstance(relation, int) or relation < 1:
            raise ValueError("Use an account category ID for each choice.")
        if not isinstance(choice.get("enabled"), bool):
            raise ValueError("Each category choice is either enabled or disabled.")
        choices[relation] = choice["enabled"]
    return [
        {"relation": relation, "enabled": enabled}
        for relation, enabled in sorted(choices.items())
    ]


def normalize_excluded_titles(value):
    """Movies and series a profile leaves out, whatever its filters allow."""
    if value in (None, ""):
        return []
    if not isinstance(value, list):
        raise ValueError("Excluded titles must be a list.")
    titles = set()
    for title in value:
        if not isinstance(title, dict) or title.get("content_type") not in (
            "movie",
            "series",
        ):
            raise ValueError("Each excluded title needs a movie or series type.")
        content_id = title.get("id")
        if (
            isinstance(content_id, bool)
            or not isinstance(content_id, int)
            or content_id < 1
        ):
            raise ValueError("Use a Library title ID for each excluded title.")
        titles.add((title["content_type"], content_id))
    return [
        {"content_type": content_type, "id": content_id}
        for content_type, content_id in sorted(titles)
    ]


def normalize_content_filters(value):
    """Hard filters every source must pass before ranking and editions."""
    if value in (None, ""):
        return {}
    if not isinstance(value, dict):
        raise ValueError("Content filters must be an object.")
    unknown = set(value) - {
        "audio_languages",
        "subtitle_languages",
        "resolution_min",
        "resolution_max",
        "required_features",
        "excluded_features",
        "excluded_genres",
        "adult_mode",
        "anime_mode",
        "missing_tmdb_mode",
    }
    if unknown:
        raise ValueError("Unsupported content filter.")
    filters = {
        "audio_languages": normalize_languages(
            _list(value.get("audio_languages"), "DUB languages")
        ),
        "subtitle_languages": normalize_languages(
            _list(value.get("subtitle_languages"), "SUB languages")
        ),
        "resolution_min": _height(value.get("resolution_min"), "Minimum resolution"),
        "resolution_max": _height(value.get("resolution_max"), "Maximum resolution"),
        "required_features": _features(
            value.get("required_features"), "required features"
        ),
        "excluded_features": _features(
            value.get("excluded_features"), "excluded features"
        ),
        "excluded_genres": list(
            dict.fromkeys(
                _text(term, "genre")
                for term in _list(value.get("excluded_genres"), "excluded genres")
                if str(term or "").strip()
            )
        ),
        "adult_mode": value.get("adult_mode") or "",
        "anime_mode": value.get("anime_mode") or "",
        "missing_tmdb_mode": value.get("missing_tmdb_mode") or "",
    }
    modes = ("adult_mode", "anime_mode", "missing_tmdb_mode")
    if any(filters[mode] not in CONTENT_MODES for mode in modes):
        raise ValueError("Adult, anime and TMDB filters are empty, exclude or only.")
    if (
        filters["resolution_max"]
        and filters["resolution_min"] > filters["resolution_max"]
    ):
        raise FieldError(
            "resolution_max", "Choose a maximum at or above the minimum."
        )
    if set(filters["required_features"]) & set(filters["excluded_features"]):
        raise FieldError(
            "excluded_features", "A feature cannot be required and excluded."
        )
    return {key: item for key, item in filters.items() if item not in ("", [], 0)}


# Each set of source values an edition can require or exclude.
EDITION_SETS = ("audio_languages", "subtitle_languages", "video_features")
EDITION_CONDITIONS = ("min_resolution", "max_resolution") + tuple(
    f"{kind}_{field}" for field in EDITION_SETS for kind in ("required", "excluded")
)


def normalize_edition_rules(value):
    """Editions that split a title into separate entries.

    A source fits at most one edition, so editions may not overlap and their
    order does not matter.
    """
    rules, seen, suffixes = [], set(), set()
    for index, rule in enumerate(_ordered_rules(value, "editions")):
        try:
            suffix = _text(
                rule.get("title_suffix") or rule.get("name"),
                "an edition name",
                required=True,
            )
        except ValueError as error:
            raise FieldError("title_suffix", str(error), index)
        if suffix.casefold() in suffixes:
            raise FieldError(
                "title_suffix", "Use a unique name for each edition.", index
            )
        suffixes.add(suffix.casefold())
        normalized = {
            "id": _rule_id(rule, "edition", index, seen),
            "name": _text(rule.get("name") or suffix, "an edition name"),
            "title_suffix": suffix,
            "min_resolution": _height(rule.get("min_resolution"), "Minimum resolution"),
            "max_resolution": _height(rule.get("max_resolution"), "Maximum resolution"),
        }
        for kind in ("required", "excluded"):
            normalized[f"{kind}_audio_languages"] = normalize_languages(
                _list(rule.get(f"{kind}_audio_languages"), "DUB languages")
            )
            normalized[f"{kind}_subtitle_languages"] = normalize_languages(
                _list(rule.get(f"{kind}_subtitle_languages"), "SUB languages")
            )
            normalized[f"{kind}_video_features"] = _features(
                rule.get(f"{kind}_video_features"), "features"
            )
        if (
            normalized["max_resolution"]
            and normalized["min_resolution"] > normalized["max_resolution"]
        ):
            raise FieldError(
                "max_resolution", "Choose a maximum at or above the minimum.", index
            )
        for field in EDITION_SETS:
            if set(normalized[f"required_{field}"]) & set(
                normalized[f"excluded_{field}"]
            ):
                raise FieldError(
                    f"excluded_{field}",
                    "A value cannot be required and excluded.",
                    index,
                )
        if not any(normalized[key] for key in EDITION_CONDITIONS):
            raise FieldError(
                "conditions", "Give each edition at least one condition.", index
            )
        for other in rules:
            overlap = edition_overlap(other, normalized)
            if overlap:
                raise FieldError("conditions", overlap, index)
        rules.append(normalized)
    return rules


def _condition(rule, key):
    value = rule.get(key) or 0
    return frozenset(value) if isinstance(value, list) else value


def _value_label(field, value):
    if field == "video_features":
        return value.removeprefix("custom:").upper()
    return value.upper()


def edition_overlap(first, second):
    """Why both editions could take the same source, or "" when none fits both.

    Names a source that fits both and an exclusion that separates them.
    """
    low = max(first["min_resolution"], second["min_resolution"])
    highs = [rule["max_resolution"] for rule in (first, second) if rule["max_resolution"]]
    if highs and low > min(highs):
        return ""
    required = {}
    for field in EDITION_SETS:
        values = set(first.get(f"required_{field}", [])) | set(
            second.get(f"required_{field}", [])
        )
        excluded = set(first.get(f"excluded_{field}", [])) | set(
            second.get(f"excluded_{field}", [])
        )
        if values & excluded:
            return ""
        required[field] = sorted(values)
    a, b = first["title_suffix"], second["title_suffix"]
    if all(_condition(first, key) == _condition(second, key) for key in EDITION_CONDITIONS):
        return f"{a} and {b} have the same conditions."
    height = low or min(highs, default=0)
    words = [f"{height}p"] if height else []
    words += [_value_label("video_features", item) for item in required["video_features"]]
    if required["audio_languages"]:
        words.append("/".join(item.upper() for item in required["audio_languages"]))
    example = f"{' '.join(words)} sources" if words else "All sources"
    if required["subtitle_languages"]:
        example += " with " + "/".join(
            item.upper() for item in required["subtitle_languages"]
        ) + " subtitles"
    # Excluding a value the other edition requires separates them.
    for field in ("video_features", "audio_languages", "subtitle_languages"):
        for target, other in ((first, second), (second, first)):
            extra = [
                item
                for item in other.get(f"required_{field}", [])
                if item not in target.get(f"required_{field}", [])
            ]
            if extra:
                hint = f"Exclude {_value_label(field, extra[0])} from {target['title_suffix']}."
                return f"{a} and {b} overlap: {example} fit both. {hint}"
    return f"{a} and {b} overlap: {example} fit both. Narrow their conditions."


def normalize_ranking(value):
    if not isinstance(value, list) or set(value) - set(RANKING_CRITERIA):
        raise ValueError("Use only supported ranking criteria.")
    ranking = list(dict.fromkeys(value))
    if {"resolution_desc", "resolution_asc"} <= set(ranking):
        raise ValueError("Choose one resolution direction.")
    return ranking


def normalize_language_order(value, field):
    return normalize_languages(_list(value, field))


def normalize_provider_order(value):
    accounts = []
    for item in _list(value, "provider order"):
        try:
            account = int(item)
        except (TypeError, ValueError):
            raise ValueError("Use M3U account IDs for the provider order.")
        if account <= 0:
            raise ValueError("Use M3U account IDs for the provider order.")
        if account not in accounts:
            accounts.append(account)
    return accounts


def _name_fields(template):
    try:
        return {
            name
            for _literal, name, _spec, _conversion in string.Formatter().parse(template)
            if name is not None
        }
    except ValueError as error:
        raise ValueError(f"Invalid output name format: {error}")


def normalize_name_template(value):
    template = str(value or "").strip()
    if not template or len(template) > 500:
        raise ValueError("Enter an output name format of up to 500 characters.")
    fields = _name_fields(template)
    if "" in fields or fields - NAME_PLACEHOLDERS:
        unsupported = sorted(field or "{}" for field in fields - NAME_PLACEHOLDERS)
        raise ValueError("Unsupported placeholders: " + ", ".join(unsupported))
    if "title" not in fields:
        raise ValueError("Include {title} in the output name format.")
    return template


def check_compact_name(output_mode, template):
    """Compact names only use the title, its year and the edition."""
    if output_mode != VODProfile.OutputMode.COMPACT:
        return
    if _name_fields(template) - COMPACT_PLACEHOLDERS:
        raise ValueError(
            "Compact names only show {title}, {year} and {edition}; "
            "use Sources for source details."
        )


NAME_LABEL_FIELDS = ("dub", "sub", "resolution", "features")
# Two or more languages of a source, e.g. MULTI-SUB.
SEVERAL = "several"
# Every value without a label of its own, e.g. to hide all but 2160p.
OTHER = "other"


def normalize_name_labels(value):
    """Replacement texts for placeholder values; an empty text hides the value.

    A label matches one value, an exact combination of languages or features
    (e.g. ger + eng as DUAL), several languages, or any other value.
    """
    if value in (None, ""):
        return []
    if not isinstance(value, list) or len(value) > MAX_RULES:
        raise ValueError(f"Use at most {MAX_RULES} name labels.")
    labels, seen = [], set()
    for row in value:
        if not isinstance(row, dict):
            raise ValueError("Each name label needs a placeholder, values and a text.")
        field = row.get("field")
        if field not in NAME_LABEL_FIELDS:
            raise ValueError("Name labels replace {dub}, {sub}, {resolution} or {features}.")
        raw = row.get("values", [row["value"]] if "value" in row else [])
        items = [str(item or "").strip() for item in _list(raw, "label values")]
        items = [item for item in items if item]
        if not items:
            raise ValueError("Choose the values a name label replaces.")
        special = {SEVERAL, OTHER} & set(items)
        if special and len(items) > 1:
            raise ValueError("Several languages and Any other value stand alone.")
        if SEVERAL in items and field not in ("dub", "sub"):
            raise ValueError("Several applies to DUB and SUB languages only.")
        if field == "resolution" and len(items) > 1:
            raise ValueError("A source has one resolution; label each on its own.")
        if not special:
            if field in ("dub", "sub"):
                items = normalize_languages(items)
            elif field == "resolution":
                items = [normalize_resolution(items[0])]
            else:
                items = list(dict.fromkeys(normalize_video_feature(item) for item in items))
        key = (field, frozenset(items))
        if key in seen:
            raise ValueError("Label each value or combination only once per placeholder.")
        seen.add(key)
        labels.append(
            {"field": field, "values": sorted(items), "label": _text(row.get("label"), "label")}
        )
    return labels
