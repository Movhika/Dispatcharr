from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("m3u", "0020_m3ugrouprule")]

    operations = [
        migrations.AddField(
            model_name="m3ugrouprule",
            name="exclude_regex_pattern",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Optional regular expression which vetoes an otherwise matching rule.",
                max_length=500,
            ),
        ),
        migrations.AddField(
            model_name="m3ugrouprule",
            name="metadata_defaults",
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text="Initial VOD DUB/SUB/resolution assumptions for newly discovered categories.",
            ),
        ),
    ]
