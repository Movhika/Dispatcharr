from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("vod", "0010_vod_profile_selections"),
    ]

    operations = [
        migrations.AddField(
            model_name="vodaccesspolicy",
            name="selection_progress",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
