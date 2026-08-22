from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("m3u", "0019_m3uaccountprofile_exp_date")]

    operations = [
        migrations.CreateModel(
            name="M3UGroupRule",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("scope", models.CharField(choices=[("live", "Live TV"), ("movie", "VOD Movies"), ("series", "VOD Series")], max_length=10)),
                ("match_field", models.CharField(choices=[("group_name", "Group name"), ("item_name", "Contained item name")], default="group_name", max_length=20)),
                ("match_mode", models.CharField(choices=[("any", "Any item"), ("all", "All items")], default="any", help_text="Used only when matching contained item names.", max_length=10)),
                ("regex_pattern", models.CharField(max_length=500)),
                ("action", models.CharField(choices=[("enable", "Enable"), ("disable", "Import disabled"), ("ignore", "Ignore")], default="disable", max_length=10)),
                ("case_sensitive", models.BooleanField(default=False)),
                ("enabled", models.BooleanField(default=True)),
                ("order", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("m3u_account", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="group_rules", to="m3u.m3uaccount")),
            ],
            options={"ordering": ("scope", "order", "id")},
        ),
        migrations.AddIndex(
            model_name="m3ugrouprule",
            index=models.Index(fields=["m3u_account", "scope", "enabled", "order"], name="m3u_group_rule_lookup_idx"),
        ),
    ]
