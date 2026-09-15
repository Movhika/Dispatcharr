from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("vod", "0024_remove_profile_category_defaults"),
    ]

    operations = [
        migrations.AddField(
            model_name="vodaccesspolicy",
            name="canonical_title_source",
            field=models.CharField(
                choices=[
                    ("primary", "Primary canonical title"),
                    ("secondary", "Secondary canonical title"),
                ],
                default="primary",
                help_text=(
                    "Localized canonical title used by variant output formats. "
                    "A missing localized title falls back to the original "
                    "provider title."
                ),
                max_length=10,
            ),
        ),
    ]
