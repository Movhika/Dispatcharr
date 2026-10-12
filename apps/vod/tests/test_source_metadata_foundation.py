from django.test import TestCase

from apps.m3u.models import M3UAccount
from apps.vod.metadata import (
    effective_relation_metadata,
    initialize_relation_metadata,
)
from apps.vod.models import (
    M3UMovieRelation,
    M3UVODCategoryRelation,
    Movie,
    VODCategory,
)


class SourceMetadataFoundationTests(TestCase):
    def test_source_metadata_keeps_upstream_language_identity_separate(self):
        account = M3UAccount.objects.create(name="two-language-provider")
        movies = [
            Movie.objects.create(name="Example", tmdb_id="123", language=language)
            for language in ("de", "en")
        ]
        relations = [
            M3UMovieRelation.objects.create(
                m3u_account=account,
                movie=movie,
                stream_id=str(index),
            )
            for index, movie in enumerate(movies, start=1)
        ]
        for relation in relations:
            initialize_relation_metadata(relation)
            relation.refresh_from_db()
        self.assertEqual(
            list(Movie.objects.order_by("language").values_list("language", flat=True)),
            ["de", "en"],
        )
        self.assertEqual([relation.movie_id for relation in relations], [movie.id for movie in movies])

    def test_category_defaults_are_stored_on_the_exact_provider_relation(self):
        account = M3UAccount.objects.create(
            name="metadata-provider",
            account_type=M3UAccount.Types.XC,
            server_url="https://provider.example",
            username="user",
            password="secret",
        )
        category = VODCategory.objects.create(
            name="German movies", category_type="movie"
        )
        M3UVODCategoryRelation.objects.create(
            m3u_account=account,
            category=category,
            enabled=True,
            metadata_defaults={
                "audio_languages": ["ger"],
                "resolution": "1080p",
            },
        )
        movie = Movie.objects.create(name="Example", year=2024)
        relation = M3UMovieRelation.objects.create(
            m3u_account=account,
            movie=movie,
            category=category,
            stream_id="123",
            container_extension="mkv",
        )

        initialize_relation_metadata(relation)
        relation.refresh_from_db()
        self.assertEqual(relation.declared_metadata["audio_languages"], ["ger"])
        self.assertEqual(relation.declared_metadata["resolution"], "1080p")

        relation.manual_metadata = {"audio_languages": ["eng"]}
        relation.save(update_fields=["manual_metadata"])
        effective = effective_relation_metadata(relation)
        self.assertEqual(effective["values"]["audio_languages"], ["eng"])
        self.assertEqual(effective["provenance"]["audio_languages"], "manual")
