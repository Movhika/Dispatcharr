from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("m3u", "0021_category_rules_and_setup"),
    ]

    operations = [
        migrations.AlterField(
            model_name="m3uaccount",
            name="account_type",
            field=models.CharField(
                choices=[("STD", "Standard"), ("XC", "Xtream Codes"), ("MAN", "Manual")],
                default="STD",
            ),
        ),
    ]
