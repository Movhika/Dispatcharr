import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("dispatcharr_channels", "0045_event_channel_group_epg"),
    ]

    operations = [
        migrations.AddField(
            model_name="channelstream",
            name="origin",
            field=models.CharField(
                choices=[("manual", "Manual"), ("rule", "Stream rule")],
                default="manual",
                max_length=10,
            ),
        ),
        migrations.CreateModel(
            name="ChannelStreamRule",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("enabled", models.BooleanField(default=True)),
                ("match_name", models.BooleanField(default=True, help_text="Find streams whose names match the channel name.")),
                ("names", models.JSONField(blank=True, default=list, help_text="Further names of this channel.")),
                ("include_regex", models.CharField(blank=True, help_text="Also find streams whose names match this.", max_length=500)),
                ("exclude_regex", models.CharField(blank=True, help_text="Leave out streams whose names match this.", max_length=500)),
                ("catchup", models.CharField(choices=[("include", "Catch-up streams too"), ("exclude", "Without catch-up streams"), ("only", "Only catch-up streams")], default="include", max_length=10)),
                ("account_ids", models.JSONField(blank=True, default=list, help_text="Only streams of these accounts; empty means all.")),
                ("countries", models.JSONField(blank=True, default=list, help_text="Only these country prefixes; streams without one always count.")),
                ("excluded_stream_ids", models.JSONField(blank=True, default=list, help_text="Streams removed by hand that the rule must not add again.")),
                ("last_applied_at", models.DateTimeField(blank=True, null=True)),
                ("channel", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="stream_rule", to="dispatcharr_channels.channel")),
            ],
        ),
    ]
