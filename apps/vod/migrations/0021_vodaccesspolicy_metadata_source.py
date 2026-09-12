from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("vod", "0020_relation_tmdb_overrides"),
    ]

    operations = [
        migrations.AddField(
            model_name="vodaccesspolicy",
            name="metadata_source",
            field=models.CharField(
                choices=[
                    ("provider", "Provider metadata"),
                    ("canonical", "Canonical / TMDB metadata"),
                ],
                default="provider",
                help_text=(
                    "Metadata projected to clients for variants output. "
                    "Compact always uses canonical metadata."
                ),
                max_length=16,
            ),
        ),
    ]
