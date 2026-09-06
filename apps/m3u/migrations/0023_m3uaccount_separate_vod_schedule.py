from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("django_celery_beat", "0019_alter_periodictasks_options"),
        ("m3u", "0022_m3uaccounttemplate"),
    ]

    operations = [
        migrations.AddField(
            model_name="m3uaccount",
            name="vod_refresh_after_live",
            field=models.BooleanField(
                default=True,
                help_text=(
                    "Refresh VOD after every successful Live TV refresh instead of "
                    "using the separate VOD schedule."
                ),
            ),
        ),
        migrations.AddField(
            model_name="m3uaccount",
            name="vod_refresh_interval",
            field=models.IntegerField(default=0),
        ),
        migrations.AddField(
            model_name="m3uaccount",
            name="vod_refresh_task",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to="django_celery_beat.periodictask",
            ),
        ),
    ]
