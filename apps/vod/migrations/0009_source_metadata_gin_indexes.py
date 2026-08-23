from django.contrib.postgres.indexes import GinIndex
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("vod", "0008_default_vod_access_policy")]

    operations = [
        migrations.AddIndex(
            model_name="vodsourceasset",
            index=GinIndex(
                fields=("manual_metadata",), name="vod_asset_manual_gin"
            ),
        ),
        migrations.AddIndex(
            model_name="vodsourceasset",
            index=GinIndex(
                fields=("observed_metadata",), name="vod_asset_observed_gin"
            ),
        ),
        migrations.AddIndex(
            model_name="vodsourceasset",
            index=GinIndex(
                fields=("declared_metadata",), name="vod_asset_declared_gin"
            ),
        ),
        migrations.AddIndex(
            model_name="m3uvodcategoryrelation",
            index=GinIndex(
                fields=("metadata_defaults",), name="vod_cat_defaults_gin"
            ),
        ),
    ]
