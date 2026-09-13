from django.db import migrations, models


def remove_sparse_bitrate_ranking(apps, schema_editor):
    policy_model = apps.get_model("vod", "VODAccessPolicy")
    for policy in policy_model.objects.all().only("id", "ranking"):
        ranking = [
            key
            for key in (policy.ranking or [])
            if key not in {"bitrate_desc", "bitrate_asc"}
        ]
        if ranking != (policy.ranking or []):
            policy_model.objects.filter(pk=policy.pk).update(ranking=ranking)


class Migration(migrations.Migration):
    dependencies = [
        ("vod", "0021_vodaccesspolicy_metadata_source"),
    ]

    operations = [
        migrations.RunPython(
            remove_sparse_bitrate_ranking,
            migrations.RunPython.noop,
        ),
        migrations.AlterField(
            model_name="vodaccesspolicy",
            name="selection_status",
            field=models.CharField(
                choices=[
                    ("pending", "Pending"),
                    ("building", "Building"),
                    ("ready", "Ready"),
                    ("outdated", "Outdated"),
                    ("failed", "Failed"),
                ],
                default="pending",
                max_length=10,
            ),
        ),
    ]
