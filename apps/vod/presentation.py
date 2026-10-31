"""Canonical title precedence shared by the Library and client catalogues."""


def canonical_title(content, languages):
    metadata = content.tmdb_metadata or {}
    localized = metadata.get("localized") or {}
    translations = (
        (localized.get(language) or {}).get("title") for language in languages
    )
    for value in (
        content.display_name,
        *translations,
        content.clean_title,
        content.name,
    ):
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def canonical_title_expression(prefix, languages):
    """Resolve the same title in SQL, without fetching full metadata per row."""
    from django.db.models import F, TextField, Value
    from django.db.models.fields.json import KeyTextTransform, KeyTransform
    from django.db.models.functions import Coalesce, NullIf, Trim

    localized = KeyTransform("localized", F(f"{prefix}tmdb_metadata"))
    candidates = [
        F(f"{prefix}display_name"),
        *(
            KeyTextTransform("title", KeyTransform(language, localized))
            for language in languages
        ),
        F(f"{prefix}clean_title"),
        F(f"{prefix}name"),
    ]
    return Coalesce(
        *(NullIf(Trim(value), Value("")) for value in candidates),
        Value(""),
        output_field=TextField(),
    )


def canonical_title_search(prefix, languages, query):
    from django.db.models import Q

    fields = [f"{prefix}{field}" for field in ("name", "clean_title", "display_name")]
    fields.extend(
        f"{prefix}tmdb_metadata__localized__{language}__title" for language in languages
    )
    matching = Q()
    for field in fields:
        matching |= Q(**{f"{field}__icontains": query})
    return matching


def sort_title_expression(languages, prefix=""):
    from django.db.models.functions import Lower, Substr

    return Substr(Lower(canonical_title_expression(prefix, languages)), 1, 255)


def search_title_expression(languages):
    """Every title the Library search matches, one per line, lowercased."""
    from django.db.models import F, Func, TextField, Value
    from django.db.models.fields.json import KeyTextTransform, KeyTransform
    from django.db.models.functions import Lower

    localized = KeyTransform("localized", F("tmdb_metadata"))
    return Lower(
        Func(
            Value("\n"),
            F("name"),
            F("clean_title"),
            F("display_name"),
            *(
                KeyTextTransform("title", KeyTransform(language, localized))
                for language in languages
            ),
            function="CONCAT_WS",
            output_field=TextField(),
        )
    )


def library_title_search(prefix, query):
    """Search the stored titles instead of every title's full metadata."""
    from django.db.models import Q

    return Q(**{f"{prefix}search_title__icontains": query})


# TMDB offers (from JustWatch) that include a title without buying or renting it.
STREAMING_ACCESS = ("flatrate", "free", "ads")


def streaming_services_expression():
    """The streaming services in a title's TMDB data, per region, in SQL."""
    from django.db.models import JSONField
    from django.db.models.expressions import RawSQL

    access = ", ".join(f"('{name}')" for name in STREAMING_ACCESS)
    return RawSQL(
        "COALESCE(("
        "SELECT jsonb_agg(service ORDER BY service) FROM ("
        "SELECT DISTINCT jsonb_build_object("
        "'region', region.key, 'id', provider -> 'id', 'name', provider ->> 'name'"
        ") AS service "
        "FROM jsonb_each(CASE WHEN jsonb_typeof(tmdb_metadata -> 'watch_providers')"
        " = 'object' THEN tmdb_metadata -> 'watch_providers' ELSE '{}'::jsonb END)"
        " AS region "
        f"CROSS JOIN (VALUES {access}) AS access (name) "
        "CROSS JOIN LATERAL jsonb_path_query(region.value -> access.name, 'lax $[*]')"
        " AS provider "
        "WHERE jsonb_typeof(provider -> 'id') = 'number'"
        ") AS services), '[]'::jsonb)",
        [],
        output_field=JSONField(),
    )


def refresh_library_titles(model, ids=None, languages=None):
    """Store the sort and search titles and the streaming services of changed
    titles; returns the count."""
    from django.db.models import BooleanField, Q
    from django.db.models.expressions import RawSQL

    if languages is None:
        from .library import library_settings

        languages = library_settings()["languages"]
    rows = model.objects.all() if ids is None else model.objects.filter(pk__in=ids)
    sort_title = sort_title_expression(languages)
    search_title = search_title_expression(languages)
    streaming = streaming_services_expression()
    changed = (
        ~Q(sort_title=sort_title)
        | ~Q(search_title=search_title)
        | Q(
            RawSQL(
                f"streaming_services IS DISTINCT FROM ({streaming.sql})",
                streaming.params,
                output_field=BooleanField(),
            )
        )
    )
    return rows.filter(changed).update(
        sort_title=sort_title,
        search_title=search_title,
        streaming_services=streaming,
    )
