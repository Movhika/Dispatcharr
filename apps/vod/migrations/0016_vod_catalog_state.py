import time

from django.db import migrations, models


def seed_catalog_state(apps, schema_editor):
    VODAccessPolicy = apps.get_model("vod", "VODAccessPolicy")
    VODCatalogState = apps.get_model("vod", "VODCatalogState")
    generation = (
        VODAccessPolicy.objects.exclude(selection_catalog_generation="")
        .order_by("-selection_completed_at")
        .values_list("selection_catalog_generation", flat=True)
        .first()
    )
    VODCatalogState.objects.update_or_create(
        pk=1,
        defaults={"selection_generation": str(generation or time.time_ns())},
    )


class Migration(migrations.Migration):
    dependencies = [
        ("vod", "0015_vod_profile_editions"),
    ]

    operations = [
        migrations.CreateModel(
            name="VODCatalogState",
            fields=[
                (
                    "id",
                    models.PositiveSmallIntegerField(
                        default=1, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("selection_generation", models.CharField(max_length=64)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "VOD catalog state",
                "verbose_name_plural": "VOD catalog state",
            },
        ),
        migrations.RunPython(seed_catalog_state, migrations.RunPython.noop),
    ]
