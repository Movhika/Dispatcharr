from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("m3u", "0021_m3ugrouprule_vod_defaults")]

    operations = [
        migrations.CreateModel(
            name="M3UAccountTemplate",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=255, unique=True)),
                ("description", models.TextField(blank=True, default="")),
                ("account_type", models.CharField(choices=[("STD", "Standard"), ("XC", "Xtream Codes")], default="XC", max_length=3)),
                ("account_settings", models.JSONField(blank=True, default=dict)),
                ("filters", models.JSONField(blank=True, default=list)),
                ("group_rules", models.JSONField(blank=True, default=list)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ("name", "id")},
        ),
    ]
