"""Persistent, private Live inventory before account stream filtering."""

import gzip
import json
import logging
import os
import tempfile
from datetime import datetime, timezone

from django.conf import settings

logger = logging.getLogger(__name__)


def _catalog_path(account_id, scope="live"):
    if scope not in ("live", "live-groups", "movie", "series"):
        raise ValueError("Unknown catalog scope")
    return os.path.join(
        settings.M3U_FILTER_CATALOG_ROOT,
        f"{int(account_id)}.{scope}-filter-preview.jsonl.gz",
    )


def write_live_filter_catalog(account_id, streams, *, publish=True, scope="live"):
    """Atomically replace the snapshot; failures keep the previous snapshot."""
    path = _catalog_path(account_id, scope)
    temporary_path = None
    try:
        os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            dir=os.path.dirname(path), prefix=f".{int(account_id)}-", delete=False
        ) as temporary:
            temporary_path = temporary.name
        with gzip.open(temporary_path, "wt", encoding="utf-8") as output:
            for index, stream in enumerate(streams):
                attributes = stream.get("attributes") or {}
                output.write(
                    json.dumps(
                        {
                            "id": f"catalog-{index}",
                            "name": str(stream.get("name") or ""),
                            "group": str(attributes.get("group-title") or ""),
                            "url": str(stream.get("url") or ""),
                        },
                        ensure_ascii=False,
                    )
                )
                output.write("\n")
        if publish:
            os.replace(temporary_path, path)
            return True
        return temporary_path
    except Exception:
        logger.warning(
            "Could not update Live filter catalog for account %s",
            account_id,
            exc_info=True,
        )
        if temporary_path:
            try:
                os.remove(temporary_path)
            except OSError:
                pass
        return False


def publish_live_filter_catalog(account_id, temporary_path, *, scope="live"):
    if temporary_path:
        try:
            os.utime(temporary_path, None)
            os.replace(temporary_path, _catalog_path(account_id, scope))
        except OSError:
            logger.warning(
                "Could not publish Live filter catalog for account %s",
                account_id,
                exc_info=True,
            )
            discard_live_filter_catalog(temporary_path)


def discard_live_filter_catalog(temporary_path):
    if temporary_path:
        try:
            os.remove(temporary_path)
        except FileNotFoundError:
            pass
        except OSError:
            logger.warning(
                "Could not discard staged Live filter catalog", exc_info=True
            )


def has_live_filter_catalog(account_id, scope="live"):
    return os.path.isfile(_catalog_path(account_id, scope))


def live_filter_catalog_timestamp(account_id, scope="live"):
    return datetime.fromtimestamp(
        os.path.getmtime(_catalog_path(account_id, scope)), timezone.utc
    )


def iter_live_filter_catalog(account_id, scope="live"):
    with gzip.open(_catalog_path(account_id, scope), "rt", encoding="utf-8") as catalog:
        for line in catalog:
            if line.strip():
                yield json.loads(line)


def remove_live_filter_catalog(account_id, scope="live"):
    try:
        os.remove(_catalog_path(account_id, scope))
    except FileNotFoundError:
        pass
    except OSError:
        logger.warning(
            "Could not remove Live filter catalog for account %s",
            account_id,
            exc_info=True,
        )
