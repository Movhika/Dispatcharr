from django.db import migrations, models


def normalize_output_formats(apps, schema_editor):
    policy_model = apps.get_model("vod", "VODAccessPolicy")
    for policy in policy_model.objects.all().iterator():
        mode = policy.export_mode
        naming_mode = policy.naming_mode
        template = str(policy.name_template or "").strip()
        title_source = policy.canonical_title_source or "primary"

        if naming_mode in {"provider", "mode_default"} and mode == "variants":
            title_source = "provider"
            template = "{title}"
        elif naming_mode == "mode_default" and mode == "compact":
            title_source = title_source if title_source != "provider" else "primary"
            template = "{title} ({year}) {edition}"
        elif naming_mode == "canonical":
            title_source = title_source if title_source != "provider" else "primary"
            template = (
                "{title} ({year}) {edition}"
                if mode == "compact"
                else "{title} ({year})"
            )
        elif naming_mode == "template":
            if "{source}" in template and not any(
                marker in template for marker in ("{canonical}", "{title}")
            ):
                title_source = "provider"
                template = template.replace("{source}", "{title}")
            if "{canonical}" in template:
                replacement = (
                    "{title}" if "{year}" in template else "{title} ({year})"
                )
                template = template.replace("{canonical}", replacement)
            template = template.replace("{edition_name}", "{edition}")

        if mode == "compact" and title_source == "provider":
            title_source = "primary"
        policy.naming_mode = "template"
        policy.name_template = template or (
            "{title} ({year}) {edition}" if mode == "compact" else "{title}"
        )
        policy.canonical_title_source = title_source
        policy.save(
            update_fields=[
                "naming_mode",
                "name_template",
                "canonical_title_source",
            ]
        )


class Migration(migrations.Migration):
    dependencies = [("vod", "0025_vodaccesspolicy_canonical_title_source")]

    operations = [
        migrations.AlterField(
            model_name="vodaccesspolicy",
            name="naming_mode",
            field=models.CharField(
                choices=[
                    ("mode_default", "Default for output mode"),
                    ("provider", "Provider title"),
                    ("canonical", "Canonical title and edition"),
                    ("template", "Custom template"),
                ],
                default="template",
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name="vodaccesspolicy",
            name="name_template",
            field=models.CharField(
                blank=True,
                default="{title} ({year}) {edition}",
                help_text="Output title template used when naming_mode is template.",
                max_length=500,
            ),
        ),
        migrations.AlterField(
            model_name="vodaccesspolicy",
            name="metadata_source",
            field=models.CharField(
                choices=[
                    ("provider", "Provider metadata"),
                    ("canonical", "Canonical / TMDB metadata"),
                ],
                default="provider",
                help_text=(
                    "Descriptive metadata projected to clients independently of "
                    "the selected output title."
                ),
                max_length=16,
            ),
        ),
        migrations.AlterField(
            model_name="vodaccesspolicy",
            name="canonical_title_source",
            field=models.CharField(
                choices=[
                    ("primary", "Primary canonical title"),
                    ("secondary", "Secondary canonical title"),
                    ("provider", "Provider title"),
                ],
                default="primary",
                help_text=(
                    "Title represented by the {title} output placeholder. Provider "
                    "titles are available only for variants output."
                ),
                max_length=10,
            ),
        ),
        migrations.RunPython(normalize_output_formats, migrations.RunPython.noop),
    ]
