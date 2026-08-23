"""
Tests for VOD provider failover (PR: "Add VOD failover logic for M3U relations").

The VOD proxy previously selected a single highest-priority relation and
returned 503 if that account was at capacity, without trying other accounts
that carry the same title.

`_get_content_and_relation()` now materialises the active, priority-ordered
relations once (single DB query) and returns that list. `_order_candidates()`
is a pure in-memory helper that moves the preferred relation to the front and
removes duplicates, so the initial connection path hits the database exactly
once. stream_vod()/head_vod() then walk the ordered list and use the first
account with spare capacity.

These tests cover the in-memory ordering helper: preferred-first placement,
de-duplication, empty-input fallbacks, and the guarantee that it performs no
database access.
"""

from unittest.mock import MagicMock, patch
from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from django.http import HttpResponse
from rest_framework.test import APIRequestFactory

from apps.m3u.models import M3UAccount
from apps.vod.models import (
    Episode,
    M3UEpisodeRelation,
    M3UMovieRelation,
    M3USeriesRelation,
    Movie,
    Series,
)

from apps.proxy.vod_proxy.multi_worker_connection_manager import (
    MultiWorkerVODConnectionManager,
)

from apps.proxy.vod_proxy.views import (
    _category_scoped_candidates,
    _order_candidates,
    stream_vod,
    stream_xc_episode,
    stream_xc_movie,
)


def _rel(rel_id, priority):
    rel = MagicMock()
    rel.id = rel_id
    rel.m3u_account = MagicMock()
    rel.m3u_account.priority = priority
    return rel


class TestOrderCandidates(TestCase):
    def test_preferred_relation_is_placed_first(self):
        preferred = _rel(rel_id=2, priority=0)
        candidates = [_rel(rel_id=1, priority=5), _rel(rel_id=3, priority=2), preferred]

        result = _order_candidates(candidates, preferred_relation=preferred)

        self.assertEqual(result[0].id, 2, "Preferred relation must be first")
        self.assertEqual({r.id for r in result}, {1, 2, 3})

    def test_preferred_relation_not_duplicated(self):
        preferred = _rel(rel_id=2, priority=0)
        candidates = [preferred, _rel(rel_id=1, priority=5)]

        result = _order_candidates(candidates, preferred_relation=preferred)

        ids = [r.id for r in result]
        self.assertEqual(ids.count(2), 1, "Preferred relation must not be duplicated")
        self.assertEqual(len(result), 2)

    def test_no_preferred_keeps_order(self):
        candidates = [_rel(rel_id=1, priority=0), _rel(rel_id=2, priority=5)]

        result = _order_candidates(candidates, preferred_relation=None)

        self.assertEqual([r.id for r in result], [1, 2])

    def test_empty_with_preferred_returns_preferred(self):
        preferred = _rel(rel_id=7, priority=0)

        result = _order_candidates([], preferred_relation=preferred)

        self.assertEqual(result, [preferred])

    def test_empty_without_preferred_returns_empty(self):
        result = _order_candidates([], preferred_relation=None)

        self.assertEqual(result, [])

    def test_no_database_access(self):
        """The helper must be pure in-memory: it must never touch the ORM."""
        class Boom:
            def __init__(self, rel_id, priority):
                self.id = rel_id
                self.m3u_account = MagicMock()
                self.m3u_account.priority = priority

            def __getattr__(self, name):
                if name in ('filter', 'objects', 'all', 'select_related', 'order_by'):
                    raise AssertionError(f"ORM access attempted via .{name}()")
                raise AttributeError(name)

        candidates = [Boom(1, 0), Boom(2, 5)]

        result = _order_candidates(candidates, preferred_relation=None)

        self.assertEqual([r.id for r in result], [1, 2])


class TestCategoryScopedCandidates(TestCase):
    def test_movie_failover_cannot_leave_selected_category(self):
        selected = _rel(rel_id=1, priority=1)
        selected.category_id = 10
        same_category = _rel(rel_id=2, priority=5)
        same_category.category_id = 10
        other_category = _rel(rel_id=3, priority=10)
        other_category.category_id = 20

        result = _category_scoped_candidates(
            'movie',
            [other_category, same_category, selected],
            selected,
        )

        self.assertEqual([relation.id for relation in result], [2, 1])

    def test_episode_failover_uses_parent_series_category(self):
        selected = _rel(rel_id=1, priority=1)
        selected.series_relation.category_id = 10
        same_category = _rel(rel_id=2, priority=5)
        same_category.series_relation.category_id = 10
        other_category = _rel(rel_id=3, priority=10)
        other_category.series_relation.category_id = 20

        result = _category_scoped_candidates(
            'episode',
            [other_category, same_category, selected],
            selected,
        )

        self.assertEqual([relation.id for relation in result], [2, 1])


class TestSourceScopedIdleSessions(SimpleTestCase):
    def setUp(self):
        self.redis = MagicMock()
        self.redis.scan.return_value = (
            0,
            ['vod_persistent_connection:existing'],
        )
        self.redis.hgetall.return_value = {
            'content_obj_type': 'movie',
            'content_uuid': 'shared-movie',
            'source_key': 'movie:1:netflix-stream',
            'client_ip': '127.0.0.1',
            'client_user_agent': 'UHF',
            'last_activity': '100',
        }
        self.redis.hget.return_value = '0'
        self.manager = MultiWorkerVODConnectionManager.__new__(
            MultiWorkerVODConnectionManager
        )
        self.manager.redis_client = self.redis

    def _find(self, source_key):
        return self.manager.find_matching_idle_session(
            content_type='movie',
            content_uuid='shared-movie',
            client_ip='127.0.0.1',
            client_user_agent='UHF',
            source_key=source_key,
        )

    def test_reuses_same_source(self):
        self.assertEqual(
            self._find('movie:1:netflix-stream'),
            'existing',
        )

    def test_rejects_other_category_source(self):
        self.assertIsNone(self._find('movie:1:nickelodeon-stream'))


class TestXCRelationPlayback(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.user = get_user_model().objects.create_user(
            username='xc-variant-user',
            custom_properties={'xc_password': 'secret'},
        )
        self.account = M3UAccount.objects.create(
            name='Variant Provider',
            server_url='http://example.com',
            username='provider-user',
            password='provider-pass',
            account_type=M3UAccount.Types.XC,
            is_active=True,
            custom_properties={'enable_vod': True},
        )

    @patch('apps.proxy.vod_proxy.views.stream_vod')
    @patch('apps.proxy.vod_proxy.views.network_access_allowed', return_value=True)
    def test_movie_relation_id_resolves_exact_upstream_source(
        self, _mock_access, mock_stream_vod
    ):
        movie = Movie.objects.create(name='Shared Movie')
        relation = M3UMovieRelation.objects.create(
            m3u_account=self.account,
            movie=movie,
            stream_id='upstream-movie-42',
            container_extension='mkv',
        )
        mock_stream_vod.return_value = HttpResponse(status=204)

        response = stream_xc_movie(
            self.factory.get('/movie/xc-variant-user/secret/1.mkv'),
            username=self.user.username,
            password='secret',
            stream_id=str(relation.id),
            extension='mkv',
        )

        self.assertEqual(response.status_code, 204)
        request, content_type, content_uuid = mock_stream_vod.call_args.args[:3]
        self.assertEqual(content_type, 'movie')
        self.assertEqual(content_uuid, movie.uuid)
        self.assertEqual(request.GET['m3u_account_id'], str(self.account.id))
        self.assertEqual(request.GET['stream_id'], 'upstream-movie-42')

    @patch('apps.proxy.vod_proxy.views.stream_vod')
    @patch('apps.proxy.vod_proxy.views.network_access_allowed', return_value=True)
    def test_episode_relation_id_resolves_exact_upstream_source(
        self, _mock_access, mock_stream_vod
    ):
        series = Series.objects.create(name='Shared Series')
        series_relation = M3USeriesRelation.objects.create(
            m3u_account=self.account,
            series=series,
            external_series_id='upstream-series-9',
        )
        episode = Episode.objects.create(
            series=series,
            name='Episode 1',
            season_number=1,
            episode_number=1,
        )
        relation = M3UEpisodeRelation.objects.create(
            m3u_account=self.account,
            episode=episode,
            series_relation=series_relation,
            stream_id='upstream-episode-99',
            container_extension='mkv',
        )
        mock_stream_vod.return_value = HttpResponse(status=204)

        response = stream_xc_episode(
            self.factory.get('/series/xc-variant-user/secret/1.mkv'),
            username=self.user.username,
            password='secret',
            stream_id=str(relation.id),
            extension='mkv',
        )

        self.assertEqual(response.status_code, 204)
        request, content_type, content_uuid = mock_stream_vod.call_args.args[:3]
        self.assertEqual(content_type, 'episode')
        self.assertEqual(content_uuid, episode.uuid)
        self.assertEqual(request.GET['m3u_account_id'], str(self.account.id))
        self.assertEqual(request.GET['stream_id'], 'upstream-episode-99')

    @patch('apps.proxy.vod_proxy.views.head_vod')
    @patch('apps.proxy.vod_proxy.views.network_access_allowed', return_value=True)
    def test_movie_relation_supports_external_player_head_request(
        self, _mock_access, mock_head_vod
    ):
        movie = Movie.objects.create(name='HEAD Movie')
        relation = M3UMovieRelation.objects.create(
            m3u_account=self.account,
            movie=movie,
            stream_id='upstream-head-42',
            container_extension='mkv',
        )
        mock_head_vod.return_value = HttpResponse(status=204)

        response = stream_xc_movie(
            self.factory.head('/movie/xc-variant-user/secret/1.mkv'),
            username=self.user.username,
            password='secret',
            stream_id=str(relation.id),
            extension='mkv',
        )

        self.assertEqual(response.status_code, 204)
        request, content_type, content_uuid = mock_head_vod.call_args.args[:3]
        self.assertEqual(content_type, 'movie')
        self.assertEqual(content_uuid, movie.uuid)
        self.assertEqual(request.GET['stream_id'], 'upstream-head-42')


class TestDirectProxyHeadPlayback(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()

    @patch('apps.proxy.vod_proxy.views.head_vod')
    def test_direct_proxy_url_delegates_head_without_losing_source_query(
        self, mock_head_vod
    ):
        mock_head_vod.return_value = HttpResponse(status=204)
        request = self.factory.head(
            '/proxy/vod/movie/content-uuid'
            '?stream_id=607419&m3u_account_id=50'
        )

        response = stream_vod(
            request,
            content_type='movie',
            content_id='content-uuid',
        )

        self.assertEqual(response.status_code, 204)
        raw_request, content_type, content_id = mock_head_vod.call_args.args[:3]
        self.assertEqual(content_type, 'movie')
        self.assertEqual(content_id, 'content-uuid')
        self.assertEqual(raw_request.GET['stream_id'], '607419')
        self.assertEqual(raw_request.GET['m3u_account_id'], '50')
