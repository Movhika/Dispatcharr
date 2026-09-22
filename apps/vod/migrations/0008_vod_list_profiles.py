import django.db.models.deletion
from django.contrib.postgres.indexes import GinIndex
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("vod", "0007_vod_lists"),
    ]

    operations = [
        migrations.AddField(
            model_name="vodaccesspolicy",
            name="category_mode",
            field=models.CharField(
                choices=[
                    ("provider", "Provider categories"),
                    ("lists", "VOD lists"),
                ],
                default="provider",
                help_text="Choose provider categories or curated VOD lists for XC output.",
                max_length=12,
            ),
        ),
        migrations.AddField(
            model_name="vodaccesspolicy",
            name="include_unsorted",
            field=models.BooleanField(
                default=True,
                help_text=(
                    "When list output is enabled, retain eligible sources which "
                    "do not belong to any selected list in a virtual Unsorted category."
                ),
            ),
        ),
        migrations.AddField(
            model_name="vodmovieprofileselection",
            name="list_ids",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="vodseriesprofileselection",
            name="list_ids",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.CreateModel(
            name="VODPolicyList",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("enabled", models.BooleanField(default=True)),
                ("priority", models.IntegerField(default=0)),
                (
                    "policy",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        to="vod.vodaccesspolicy",
                    ),
                ),
                (
                    "vod_list",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        to="vod.vodlist",
                    ),
                ),
            ],
            options={
                "ordering": ("-priority", "vod_list__sort_order", "id"),
                "constraints": [
                    models.UniqueConstraint(
                        fields=("policy", "vod_list"),
                        name="unique_vod_policy_list",
                    )
                ],
            },
        ),
        migrations.AddField(
            model_name="vodaccesspolicy",
            name="vod_lists",
            field=models.ManyToManyField(
                related_name="access_policies",
                through="vod.VODPolicyList",
                to="vod.vodlist",
            ),
        ),
        migrations.AddIndex(
            model_name="vodmovieprofileselection",
            index=GinIndex(fields=["list_ids"], name="vod_mov_prof_lists_gin"),
        ),
        migrations.AddIndex(
            model_name="vodseriesprofileselection",
            index=GinIndex(fields=["list_ids"], name="vod_ser_prof_lists_gin"),
        ),
    ]
