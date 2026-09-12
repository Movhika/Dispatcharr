"""Small, testable TMDB client and canonical metadata normalizers."""

from __future__ import annotations

import re
import time
import unicodedata
from datetime import datetime, timezone

import requests


TMDB_API_ROOT = "https://api.themoviedb.org/3"
TMDB_IMAGE_ROOT = "https://image.tmdb.org/t/p"
TMDB_METADATA_SCHEMA = 3


class TMDBError(RuntimeError):
    pass


class TMDBNotFound(TMDBError):
    pass


class TMDBAuthenticationError(TMDBError):
    pass


def normalize_languages(values):
    languages = []
    for raw in values or []:
        value = str(raw or "").strip()
        match = re.fullmatch(r"([A-Za-z]{2})(?:-([A-Za-z]{2}))?", value)
        if not match:
            continue
        normalized = match.group(1).lower()
        if match.group(2):
            normalized += f"-{match.group(2).upper()}"
        if normalized not in languages:
            languages.append(normalized)
        if len(languages) == 2:
            break
    return languages or ["en-US"]


def normalize_title_rules(values):
    """Validate ordered regex replacements used only for TMDB lookup names."""
    if not isinstance(values, list):
        raise ValueError("Title rules must be a list")
    rules = []
    for index, raw in enumerate(values[:20]):
        if not isinstance(raw, dict):
            raise ValueError(f"Title rule {index + 1} must be an object")
        pattern = str(raw.get("pattern") or "").strip()
        replacement = str(raw.get("replacement") or "")
        if not pattern:
            raise ValueError(f"Title rule {index + 1} needs a pattern")
        if len(pattern) > 255 or len(replacement) > 255:
            raise ValueError(f"Title rule {index + 1} is too long")
        try:
            re.compile(pattern)
        except re.error as exc:
            raise ValueError(
                f"Title rule {index + 1} has an invalid expression: {exc}"
            ) from exc
        rules.append(
            {
                "pattern": pattern,
                "replacement": replacement,
                "enabled": raw.get("enabled") is not False,
            }
        )
    return rules


def clean_lookup_title(name, *, display_name="", year=None, rules=None):
    """Create the non-persistent title used for TMDB search and its preview.

    Provider names remain untouched. Built-in structural prefix cleanup runs
    first, followed by the administrator's ordered replacements. A trailing
    release year is removed because TMDB receives it in a dedicated parameter.
    """
    from .utils import canonical_output_name

    result = canonical_output_name(name, display_name=display_name).strip()
    for rule in normalize_title_rules(rules or []):
        if rule["enabled"]:
            result = re.sub(rule["pattern"], rule["replacement"], result)
    if year:
        result = re.sub(
            rf"\s*[\(\[]\s*{re.escape(str(year))}\s*[\)\]]\s*$",
            "",
            result,
        )
    else:
        result = re.sub(r"\s*[\(\[]\s*(?:19|20)\d{2}\s*[\)\]]\s*$", "", result)
    result = re.sub(r"^[\s\-–—:|┃]+|[\s\-–—:|┃]+$", "", result)
    return re.sub(r"\s+", " ", result).strip()


def _normalized_title(value):
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", "", text.casefold())


def _year(value):
    match = re.match(r"(\d{4})", str(value or ""))
    return int(match.group(1)) if match else None


def _translation_for_language(translations, language):
    language_code, _, country_code = language.partition("-")
    exact = None
    language_only = None
    for row in translations or []:
        if row.get("iso_639_1") != language_code:
            continue
        if language_only is None:
            language_only = row
        if country_code and row.get("iso_3166_1") == country_code:
            exact = row
            break
    return exact or language_only or {}


def _localized_values(payload, media_type, languages):
    translations = (payload.get("translations") or {}).get("translations") or []
    values = {}
    title_key = "title" if media_type == "movie" else "name"
    for language in languages:
        row = _translation_for_language(translations, language)
        data = row.get("data") if isinstance(row, dict) else {}
        data = data if isinstance(data, dict) else {}
        title = data.get(title_key)
        overview = data.get("overview")
        tagline = data.get("tagline")
        # The details response itself is already localized to the first
        # requested language and is a useful fallback when TMDB omits an
        # explicit translation row.
        if language == languages[0]:
            title = title or payload.get(title_key)
            overview = overview or payload.get("overview")
            tagline = tagline or payload.get("tagline")
        values[language] = {
            "title": str(title or "").strip(),
            "overview": str(overview or "").strip(),
            "tagline": str(tagline or "").strip(),
        }
    return values


def _provider_rows(payload, regions=None):
    provider_payload = (
        payload.get("watch/providers")
        or payload.get("watch_providers")
        or {}
    )
    results = provider_payload.get("results") or {}
    regions = {str(region).upper() for region in regions or [] if region}
    normalized = {}
    for region, region_data in results.items():
        if regions and str(region).upper() not in regions:
            continue
        if not isinstance(region_data, dict):
            continue
        row = {"link": region_data.get("link") or ""}
        for access_type in ("flatrate", "free", "ads", "rent", "buy"):
            providers = []
            for provider in region_data.get(access_type) or []:
                providers.append(
                    {
                        "id": provider.get("provider_id"),
                        "name": provider.get("provider_name") or "",
                        "logo_path": provider.get("logo_path") or "",
                        "priority": provider.get("display_priority"),
                    }
                )
            if providers:
                row[access_type] = providers
        normalized[str(region).upper()] = row
    return normalized


def image_url(path, size):
    path = str(path or "").strip()
    return f"{TMDB_IMAGE_ROOT}/{size}/{path.lstrip('/')}" if path else ""


def normalize_details(payload, media_type, languages, *, match_method):
    title_key = "title" if media_type == "movie" else "name"
    date_key = "release_date" if media_type == "movie" else "first_air_date"
    external_ids = payload.get("external_ids") or {}
    normalized_external_ids = {
        key: str(value or "").strip()
        for key, value in {
            "imdb_id": payload.get("imdb_id") or external_ids.get("imdb_id"),
            "tvdb_id": external_ids.get("tvdb_id"),
            "wikidata_id": external_ids.get("wikidata_id"),
        }.items()
        if value not in (None, "")
    }
    poster_path = payload.get("poster_path") or ""
    backdrop_path = payload.get("backdrop_path") or ""
    return {
        "schema": TMDB_METADATA_SCHEMA,
        "id": str(payload.get("id") or ""),
        "media_type": media_type,
        "match_method": match_method,
        "original_language": str(payload.get("original_language") or "").strip(),
        "localized": _localized_values(payload, media_type, languages),
        "release_date": str(payload.get(date_key) or ""),
        "release_status": str(payload.get("status") or ""),
        "overview": str(payload.get("overview") or ""),
        "tagline": str(payload.get("tagline") or ""),
        "runtime_minutes": payload.get("runtime") or (
            (payload.get("episode_run_time") or [None])[0]
        ),
        "rating": payload.get("vote_average"),
        "vote_count": payload.get("vote_count"),
        "popularity": payload.get("popularity"),
        "adult": bool(payload.get("adult", False)),
        "genres": [
            {"id": row.get("id"), "name": row.get("name") or ""}
            for row in payload.get("genres") or []
        ],
        "networks": [
            {
                "id": row.get("id"),
                "name": row.get("name") or "",
                "logo_path": row.get("logo_path") or "",
                "origin_country": row.get("origin_country") or "",
            }
            for row in payload.get("networks") or []
        ],
        "production_companies": [
            {
                "id": row.get("id"),
                "name": row.get("name") or "",
                "logo_path": row.get("logo_path") or "",
                "origin_country": row.get("origin_country") or "",
            }
            for row in payload.get("production_companies") or []
        ],
        "watch_providers": _provider_rows(
            payload,
            [language.partition("-")[2] for language in languages],
        ),
        "poster_path": poster_path,
        "poster_url": image_url(poster_path, "w500"),
        "backdrop_path": backdrop_path,
        "backdrop_url": image_url(backdrop_path, "w1280"),
        "external_ids": normalized_external_ids,
        "imdb_id": normalized_external_ids.get("imdb_id", ""),
        "tvdb_id": normalized_external_ids.get("tvdb_id", ""),
        "wikidata_id": normalized_external_ids.get("wikidata_id", ""),
        "homepage": str(payload.get("homepage") or ""),
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def preferred_title(metadata, language=None):
    """Resolve a localized title without ever falling back to provider data."""
    metadata = metadata if isinstance(metadata, dict) else {}
    localized = metadata.get("localized") or {}
    if language:
        title = (localized.get(language) or {}).get("title")
        if title:
            return str(title).strip()
    for values in localized.values():
        title = values.get("title") if isinstance(values, dict) else ""
        if title:
            return str(title).strip()
    return ""


class Client:
    def __init__(self, token, *, session=None, min_interval=0.04, timeout=15):
        self.token = str(token or "").strip()
        if not self.token:
            raise ValueError("A TMDB API token is required")
        self.session = session or requests.Session()
        self.min_interval = max(float(min_interval), 0)
        self.timeout = timeout
        self._last_request_at = 0.0

    def _auth(self):
        # TMDB v4 read tokens are long/JWT-like; v3 keys remain supported for
        # existing installations.
        if len(self.token) > 64 or self.token.count(".") == 2:
            return {"Authorization": f"Bearer {self.token}"}, {}
        return {}, {"api_key": self.token}

    def get(self, path, **params):
        headers, auth_params = self._auth()
        params = {**auth_params, **params}
        for attempt in range(4):
            delay = self.min_interval - (time.monotonic() - self._last_request_at)
            if delay > 0:
                time.sleep(delay)
            try:
                response = self.session.get(
                    f"{TMDB_API_ROOT}/{path.lstrip('/')}",
                    headers={"Accept": "application/json", **headers},
                    params=params,
                    timeout=self.timeout,
                )
            except requests.RequestException as exc:
                raise TMDBError(str(exc)) from exc
            self._last_request_at = time.monotonic()
            if response.status_code == 404:
                raise TMDBNotFound(path)
            if response.status_code in {401, 403}:
                raise TMDBAuthenticationError(
                    "TMDB rejected the configured API token"
                )
            if response.status_code == 429 or response.status_code >= 500:
                if attempt < 3:
                    retry_after = response.headers.get("Retry-After")
                    try:
                        retry_after = float(retry_after)
                    except (TypeError, ValueError):
                        retry_after = 0.5 * (attempt + 1)
                    time.sleep(min(max(retry_after, 0.1), 10))
                    continue
            try:
                response.raise_for_status()
            except requests.RequestException as exc:
                raise TMDBError(str(exc)) from exc
            try:
                payload = response.json()
            except ValueError as exc:
                raise TMDBError("TMDB returned invalid JSON") from exc
            if not isinstance(payload, dict):
                raise TMDBError("TMDB returned a non-object response")
            return payload
        raise TMDBError("TMDB request retries exhausted")

    def find_by_imdb(self, imdb_id, media_type):
        payload = self.get(
            f"find/{imdb_id}",
            external_source="imdb_id",
        )
        key = "movie_results" if media_type == "movie" else "tv_results"
        rows = payload.get(key) or []
        return str(rows[0].get("id")) if len(rows) == 1 and rows[0].get("id") else ""

    def search(self, query, year, media_type, language):
        params = {
            "query": query,
            "language": language,
            "include_adult": "true",
        }
        if year:
            params[
                "primary_release_year" if media_type == "movie" else "first_air_date_year"
            ] = year
        payload = self.get(f"search/{'movie' if media_type == 'movie' else 'tv'}", **params)
        title_keys = (
            ("title", "original_title")
            if media_type == "movie"
            else ("name", "original_name")
        )
        wanted = _normalized_title(query)
        candidates = []
        for row in payload.get("results") or []:
            names = {_normalized_title(row.get(key)) for key in title_keys}
            if wanted not in names:
                continue
            candidate_year = _year(
                row.get("release_date")
                if media_type == "movie"
                else row.get("first_air_date")
            )
            if year and candidate_year and abs(int(year) - candidate_year) > 1:
                continue
            candidates.append(row)
        if len(candidates) != 1:
            return ""
        return str(candidates[0].get("id") or "")

    def details(self, tmdb_id, media_type, languages, *, match_method):
        languages = normalize_languages(languages)
        payload = self.get(
            f"{'movie' if media_type == 'movie' else 'tv'}/{tmdb_id}",
            language=languages[0],
            append_to_response="translations,external_ids,watch/providers",
        )
        return normalize_details(
            payload,
            media_type,
            languages,
            match_method=match_method,
        )
