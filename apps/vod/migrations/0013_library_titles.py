import re

from django.db import migrations, models
from django.db.models import F, Func, JSONField, TextField, Value
from django.db.models.expressions import RawSQL
from django.db.models.fields.json import KeyTextTransform, KeyTransform
from django.db.models.functions import Coalesce, Lower, NullIf, Substr, Trim


def library_languages(apps):
    # The Library languages as stored; this migration keeps its own copy of the
    # normalization so later code changes cannot alter it.
    CoreSettings = apps.get_model("core", "CoreSettings")
    row = CoreSettings.objects.filter(key="vod_library").first()
    languages = []
    for raw in ((row.value or {}) if row else {}).get("languages") or []:
        match = re.fullmatch(r"([A-Za-z]{2})(?:-([A-Za-z]{2}))?", str(raw).strip())
        if match:
            value = match[1].lower() + (f"-{match[2].upper()}" if match[2] else "")
            if value not in languages:
                languages.append(value)
    return languages or ["en-US"]


def fill_titles(apps, schema_editor):
    languages = library_languages(apps)
    localized = KeyTransform("localized", F("tmdb_metadata"))
    translations = [
        KeyTextTransform("title", KeyTransform(language, localized))
        for language in languages
    ]
    candidates = [F("display_name"), *translations, F("clean_title"), F("name")]
    title = Coalesce(
        *(NullIf(Trim(value), Value("")) for value in candidates),
        Value(""),
        output_field=TextField(),
    )
    search = Func(
        Value("\n"),
        F("name"),
        F("clean_title"),
        F("display_name"),
        *translations,
        function="CONCAT_WS",
        output_field=TextField(),
    )
    # Subscription, free and ad-supported offers of the stored TMDB data.
    streaming = RawSQL(
        "COALESCE(("
        "SELECT jsonb_agg(service ORDER BY service) FROM ("
        "SELECT DISTINCT jsonb_build_object("
        "'region', region.key, 'id', provider -> 'id', 'name', provider ->> 'name'"
        ") AS service "
        "FROM jsonb_each(CASE WHEN jsonb_typeof(tmdb_metadata -> 'watch_providers')"
        " = 'object' THEN tmdb_metadata -> 'watch_providers' ELSE '{}'::jsonb END)"
        " AS region "
        "CROSS JOIN (VALUES ('flatrate'), ('free'), ('ads')) AS access (name) "
        "CROSS JOIN LATERAL jsonb_path_query(region.value -> access.name, 'lax $[*]')"
        " AS provider "
        "WHERE jsonb_typeof(provider -> 'id') = 'number'"
        ") AS services), '[]'::jsonb)",
        [],
        output_field=JSONField(),
    )
    for name in ("Movie", "Series"):
        apps.get_model("vod", name).objects.update(
            sort_title=Substr(Lower(title), 1, 255),
            search_title=Lower(search),
            streaming_services=streaming,
        )


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0001_initial"),
        ("vod", "0012_library_blocked"),
    ]
    operations = [
        *(
            migrations.AddField(
                model_name=model,
                name="sort_title",
                field=models.CharField(
                    blank=True, db_default="", db_index=True, default="", max_length=255
                ),
            )
            for model in ("movie", "series")
        ),
        *(
            migrations.AddField(
                model_name=model,
                name="search_title",
                field=models.TextField(blank=True, db_default="", default=""),
            )
            for model in ("movie", "series")
        ),
        *(
            migrations.AddField(
                model_name=model,
                name="streaming_services",
                field=models.JSONField(blank=True, db_default=[], default=list),
            )
            for model in ("movie", "series")
        ),
        migrations.RunPython(fill_titles, migrations.RunPython.noop),
    ]
