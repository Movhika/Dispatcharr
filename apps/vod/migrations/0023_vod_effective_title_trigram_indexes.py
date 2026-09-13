from django.contrib.postgres.operations import TrigramExtension
from django.db import migrations


EFFECTIVE_TITLE = "lower(COALESCE(NULLIF(display_name, ''), name))"


class Migration(migrations.Migration):
    dependencies = [
        ("vod", "0022_vodaccesspolicy_outdated_status"),
    ]

    operations = [
        TrigramExtension(),
        migrations.RunSQL(
            sql=(
                "CREATE INDEX IF NOT EXISTS vod_movie_title_trgm "
                f"ON vod_movie USING gin (({EFFECTIVE_TITLE}) gin_trgm_ops)"
            ),
            reverse_sql="DROP INDEX IF EXISTS vod_movie_title_trgm",
        ),
        migrations.RunSQL(
            sql=(
                "CREATE INDEX IF NOT EXISTS vod_series_title_trgm "
                f"ON vod_series USING gin (({EFFECTIVE_TITLE}) gin_trgm_ops)"
            ),
            reverse_sql="DROP INDEX IF EXISTS vod_series_title_trgm",
        ),
    ]
