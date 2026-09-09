from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("vod", "0013_canonical_display_names_and_failover_count")]

    operations = [
        migrations.AddField(
            model_name="vodaccesspolicy",
            name="provider_order",
            field=models.JSONField(
                blank=True,
                default=list,
                help_text=(
                    "Profile-specific M3U account preference from highest to lowest. "
                    "Unlisted accounts remain eligible behind listed accounts."
                ),
            ),
        ),
    ]
