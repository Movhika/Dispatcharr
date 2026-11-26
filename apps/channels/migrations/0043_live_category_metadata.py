from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("dispatcharr_channels", "0042_category_policies"),
    ]

    operations = [
        migrations.AddField(
            model_name="channelgroupm3uaccount",
            name="metadata_defaults",
            field=models.JSONField(blank=True, default=dict),
        ),
    ]
