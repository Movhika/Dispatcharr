import django.core.validators
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("m3u", "0023_m3uaccount_separate_vod_schedule"),
    ]

    operations = [
        migrations.AddField(
            model_name="m3uaccount",
            name="xc_live_refresh_min_age_minutes",
            field=models.PositiveIntegerField(
                default=55,
                help_text=(
                    "Minimum age of the last successful Live TV refresh before "
                    "an XC client request may queue another one. Use 0 to "
                    "always allow it."
                ),
                validators=[django.core.validators.MaxValueValidator(10080)],
            ),
        ),
    ]
