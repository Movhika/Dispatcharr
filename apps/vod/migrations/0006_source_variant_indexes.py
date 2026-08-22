from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('vod', '0005_movie_is_adult'),
    ]

    operations = [
        migrations.AddIndex(
            model_name='m3useriesrelation',
            index=models.Index(
                fields=['series', 'category'],
                name='vod_series_category_idx',
            ),
        ),
        migrations.AddIndex(
            model_name='m3umovierelation',
            index=models.Index(
                fields=['movie', 'category'],
                name='vod_movie_category_idx',
            ),
        ),
    ]
