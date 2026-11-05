"""When provider details are fetched again, and episodes of further series sources.

Provider lists carry a change marker per title: series their ``last_modified``,
movies their ``added`` date and container. Details are fetched again only when
that marker changed since the last fetch, or after a week as a safety net for
providers that do not keep their markers current. Details fetched before
markers were stored follow that age rule until their next fetch.
"""

import logging
import threading
import time
from datetime import timedelta

from django.core.cache import cache
from django.db import connection
from django.utils import timezone

logger = logging.getLogger(__name__)

MAX_AGE = timedelta(days=7)
SERIES_MARKER = ("last_modified",)
MOVIE_MARKER = ("added", "container_extension")
# Seconds an episode list waits for the episodes of further series sources.
FURTHER_SOURCES_WAIT = 5
LOCK_SECONDS = 300


def list_marker(relation, fields):
    basic = (relation.custom_properties or {}).get("basic_data") or {}
    return "|".join(str(basic.get(field) or "") for field in fields)


def _due(relation, fetched, last_fetch, marker_key, fields, now, max_age):
    if not fetched or not last_fetch:
        return True
    stored = (relation.custom_properties or {}).get(marker_key)
    if stored is not None and stored != list_marker(relation, fields):
        return True
    return last_fetch < (now or timezone.now()) - (max_age or MAX_AGE)


def episodes_due(relation, now=None, max_age=None):
    props = relation.custom_properties or {}
    return _due(
        relation,
        props.get("episodes_fetched") and props.get("detailed_fetched"),
        relation.last_episode_refresh,
        "episodes_marker",
        SERIES_MARKER,
        now,
        max_age,
    )


def details_due(relation, now=None, max_age=None):
    return _due(
        relation,
        (relation.custom_properties or {}).get("detailed_fetched"),
        relation.last_advanced_refresh,
        "details_marker",
        MOVIE_MARKER,
        now,
        max_age,
    )


def mark_episodes_fetched(relation, custom_properties):
    custom_properties["episodes_marker"] = list_marker(relation, SERIES_MARKER)


def mark_details_fetched(relation, custom_properties):
    custom_properties["details_marker"] = list_marker(relation, MOVIE_MARKER)


def refresh_series_sources(series, relations, wait=FURTHER_SOURCES_WAIT):
    """Fetch the episode lists of further series sources in parallel.

    Waits up to ``wait`` seconds; slower providers finish in the background and
    their episodes appear with the next request. A source already being fetched
    by another request is skipped.
    """
    from .tasks import refresh_series_episodes

    threads = []
    for relation in relations:
        lock = f"vod-series-episodes:{relation.pk}"
        if not cache.add(lock, 1, LOCK_SECONDS):
            continue

        def run(relation=relation, lock=lock):
            try:
                refresh_series_episodes(
                    relation.m3u_account, series, relation.external_series_id
                )
            except Exception:  # noqa: BLE001 -- one provider must not fail the list
                logger.warning("Episode refresh failed for series source %s", relation.pk)
            finally:
                cache.delete(lock)
                connection.close()

        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        threads.append(thread)
    deadline = time.monotonic() + wait
    for thread in threads:
        thread.join(max(0, deadline - time.monotonic()))
