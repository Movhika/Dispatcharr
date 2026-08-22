from django.db import migrations


def create_default_policy(apps, schema_editor):
    policy_model = apps.get_model("vod", "VODAccessPolicy")
    policy_model.objects.get_or_create(
        name="Default VOD preferences",
        defaults={
            "export_mode": "compact",
            "is_default": True,
            "is_active": True,
            "hard_constraints": {"allow_unknown_metadata": True},
            "ranking": [
                "audio_language",
                "subtitle_language",
                "resolution",
            ],
        },
    )


class Migration(migrations.Migration):
    dependencies = [("vod", "0007_source_management")]

    operations = [migrations.RunPython(create_default_policy, migrations.RunPython.noop)]
