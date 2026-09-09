from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("vod", "0014_vodaccesspolicy_provider_order"),
    ]

    operations = [
        migrations.AddField(
            model_name="vodaccesspolicy",
            name="edition_rules",
            field=models.JSONField(
                blank=True,
                default=list,
                help_text=(
                    "Ordered first-match rules that classify eligible sources into "
                    "editions without changing their source categories."
                ),
            ),
        ),
        migrations.AddField(
            model_name="vodaccesspolicy",
            name="naming_mode",
            field=models.CharField(
                choices=[
                    ("mode_default", "Default for output mode"),
                    ("provider", "Provider title"),
                    ("canonical", "Canonical title and edition"),
                    ("template", "Custom template"),
                ],
                default="mode_default",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="vodaccesspolicy",
            name="name_template",
            field=models.CharField(
                blank=True,
                default="{canonical} {edition}",
                help_text="Output title template used when naming_mode is template.",
                max_length=500,
            ),
        ),
        migrations.AddField(
            model_name="vodmovieprofileselection",
            name="edition_key",
            field=models.CharField(blank=True, db_index=True, max_length=48),
        ),
        migrations.AddField(
            model_name="vodmovieprofileselection",
            name="edition_name",
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name="vodmovieprofileselection",
            name="edition_suffix",
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name="vodmovieprofileselection",
            name="output_name",
            field=models.CharField(blank=True, max_length=500),
        ),
        migrations.AddField(
            model_name="vodseriesprofileselection",
            name="edition_key",
            field=models.CharField(blank=True, db_index=True, max_length=48),
        ),
        migrations.AddField(
            model_name="vodseriesprofileselection",
            name="edition_name",
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name="vodseriesprofileselection",
            name="edition_suffix",
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddField(
            model_name="vodseriesprofileselection",
            name="output_name",
            field=models.CharField(blank=True, max_length=500),
        ),
    ]
