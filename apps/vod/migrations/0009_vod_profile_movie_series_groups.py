from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("vod", "0008_vod_list_profiles"),
    ]

    operations = [
        migrations.AlterField(
            model_name="vodaccesspolicy",
            name="category_mode",
            field=models.CharField(
                choices=[
                    ("provider", "Provider categories"),
                    ("lists", "VOD lists"),
                    ("movie_series", "Movie & Series"),
                ],
                default="provider",
                help_text=(
                    "Choose provider categories, curated VOD lists, or one "
                    "category per content type for XC output."
                ),
                max_length=12,
            ),
        ),
    ]
