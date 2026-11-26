import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("dispatcharr_channels", "0043_live_category_metadata"),
    ]

    operations = [
        migrations.CreateModel(
            name="EventChannelGroup",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=255, unique=True)),
                ("enabled", models.BooleanField(default=True)),
                ("start_number", models.FloatField(default=1)),
                ("end_number", models.FloatField(blank=True, null=True)),
                ("lookahead_hours", models.PositiveIntegerField(default=24, help_text="Only events starting within this many hours get a channel.")),
                ("include_untimed", models.BooleanField(default=False, help_text="Also build channels for events without a start time.")),
                ("name_format", models.CharField(choices=[("title", "Event title"), ("title_time", "Event title and start time")], default="title_time", max_length=20)),
                ("channel_profile_ids", models.JSONField(blank=True, default=list, help_text="Channel profiles of new channels; empty means all.")),
                ("last_built_at", models.DateTimeField(blank=True, null=True)),
                ("channel_group", models.ForeignKey(blank=True, help_text="Group of the built channels.", null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="event_channel_groups", to="dispatcharr_channels.channelgroup")),
                ("sources", models.ManyToManyField(blank=True, help_text="Event categories whose events are combined.", related_name="event_channel_groups", to="dispatcharr_channels.channelgroupm3uaccount")),
            ],
            options={"ordering": ("name",)},
        ),
        migrations.CreateModel(
            name="EventChannel",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("event_key", models.CharField(max_length=255)),
                ("title", models.CharField(blank=True, max_length=512)),
                ("start", models.DateTimeField(blank=True, null=True)),
                ("channel", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="event_channel", to="dispatcharr_channels.channel")),
                ("group", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="event_channels", to="dispatcharr_channels.eventchannelgroup")),
            ],
            options={"indexes": [models.Index(fields=["group", "event_key"], name="event_channel_key_idx")]},
        ),
    ]
