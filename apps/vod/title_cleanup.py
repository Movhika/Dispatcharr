"""Configurable VOD title cleanup used before metadata lookup.

Provider titles are never changed by these helpers.
"""

from datetime import datetime, timezone
import re

DEFAULT_TITLE_YEAR_RULES = (
    {"value": "(YYYY)", "position": "anywhere", "enabled": True},
    {"value": "[YYYY]", "position": "end", "enabled": True},
    {"value": "- YYYY", "position": "anywhere", "enabled": True},
    {"value": "YYYY", "position": "end", "enabled": True},
)


def normalize_title_rules(values):
    """Normalize ordered literal prefixes removed from VOD titles.

    Older releases stored a match type or a regex ``pattern``.  Reading the
    old value remains supported, but every rule is deliberately interpreted as
    a literal prefix.  Cleanup must never make hidden regex guesses about a
    provider title.
    """
    if not isinstance(values, list):
        raise ValueError("Title rules must be a list")
    rules = []
    for index, raw in enumerate(values[:20]):
        if isinstance(raw, str):
            value = raw.strip()
            enabled = True
        elif isinstance(raw, dict):
            value = str(
                raw.get("value")
                if raw.get("value") is not None
                else raw.get("pattern") or ""
            ).strip()
            enabled = raw.get("enabled") is not False
        else:
            raise ValueError(f"Title prefix {index + 1} must be text")
        action = "remove"
        replacement = ""
        if not value:
            raise ValueError(f"Title prefix {index + 1} cannot be empty")
        if len(value) > 255:
            raise ValueError(f"Title prefix {index + 1} is too long")
        rules.append(
            {
                "match_type": "starts_with",
                "value": value,
                "action": action,
                "replacement": replacement,
                "enabled": enabled,
            }
        )
    return rules


def normalize_year_rules(values):
    """Normalize configurable release-year formats used by title cleanup.

    ``YYYY`` is the only special token. ``DEFAULT_TITLE_YEAR_RULES`` carries
    forward the formats previously hard-coded in title cleanup and parsing.
    """
    if not isinstance(values, (list, tuple)):
        raise ValueError("Year rules must be a list")
    rules = []
    for index, raw in enumerate(values[:20]):
        if isinstance(raw, str):
            value = raw.strip()
            position = "end"
            enabled = True
        elif isinstance(raw, dict):
            value = str(raw.get("value") or raw.get("format") or "").strip()
            position = str(raw.get("position") or "end").strip().lower()
            enabled = raw.get("enabled") is not False
        else:
            raise ValueError(f"Year format {index + 1} must be text")
        value = value.replace("{year}", "YYYY")
        if not value:
            raise ValueError(f"Year format {index + 1} cannot be empty")
        if value.count("YYYY") != 1:
            raise ValueError(
                f"Year format {index + 1} must contain YYYY exactly once"
            )
        if len(value) > 80:
            raise ValueError(f"Year format {index + 1} is too long")
        if position not in {"anywhere", "end"}:
            raise ValueError(
                f"Year format {index + 1} position must be anywhere or end"
            )
        rule = {"value": value, "position": position, "enabled": enabled}
        if rule not in rules:
            rules.append(rule)
    return rules


def normalize_group_title_cleanup(value):
    """Validate one category-owned regex removal rule."""
    if value in (None, "", {}):
        return {}
    if not isinstance(value, dict):
        raise ValueError("Category title removal must be an object")
    pattern = str(value.get("pattern") or "").strip()
    if not pattern:
        return {}
    if len(pattern) > 500:
        raise ValueError("Category title removal regex is too long")
    try:
        re.compile(pattern)
    except re.error as exc:
        raise ValueError(f"Invalid category title removal regex: {exc}") from exc
    return {
        "pattern": pattern,
        "case_sensitive": value.get("case_sensitive") is True,
    }


def _year_rule_pattern(rule, *, expected_year=None):
    value = rule["value"]
    escaped = re.escape(value)
    escaped = escaped.replace(r"\ ", r"\s+")
    year_pattern = (
        re.escape(str(expected_year))
        if expected_year is not None
        else r"(?P<year>(?:19|20)\d{2})"
    )
    pattern = escaped.replace(re.escape("YYYY"), year_pattern)
    pattern = rf"(?<!\d){pattern}(?!\d)"
    if rule["position"] == "end":
        pattern = rf"{pattern}\s*$"
    return pattern


def extract_year_from_title(title, rules=None):
    """Extract one plausible release year using configured title formats."""
    text = str(title or "")
    if not text:
        return None
    normalized = normalize_year_rules(
        DEFAULT_TITLE_YEAR_RULES if rules is None else rules
    )
    maximum_year = datetime.now(timezone.utc).year + 5
    for rule in normalized:
        if not rule["enabled"]:
            continue
        match = re.search(_year_rule_pattern(rule), text)
        if not match:
            continue
        raw_year = match.groupdict().get("year")
        if raw_year and 1900 <= int(raw_year) <= maximum_year:
            return int(raw_year)
    return None


def _remove_configured_year(title, *, year=None, rules=None):
    result = str(title or "")
    normalized = normalize_year_rules(
        DEFAULT_TITLE_YEAR_RULES if rules is None else rules
    )
    expected_year = year or extract_year_from_title(result, normalized)
    if not expected_year:
        return result
    for rule in normalized:
        if not rule["enabled"]:
            continue
        result, count = re.subn(
            _year_rule_pattern(rule, expected_year=expected_year),
            "",
            result,
            count=1,
        )
        if count:
            break
    return result


def _apply_group_title_cleanup(title, rule):
    normalized = normalize_group_title_cleanup(rule)
    if not normalized:
        return str(title or "")
    flags = 0 if normalized["case_sensitive"] else re.IGNORECASE
    return re.sub(normalized["pattern"], "", str(title or ""), flags=flags)


def clean_lookup_title(
    name,
    *,
    display_name="",
    year=None,
    rules=None,
    year_rules=None,
    group_rule=None,
):
    """Create the non-persistent title used for TMDB search and its preview.

    Provider names remain untouched. The administrator's global prefix and
    year cleanup runs first, so a broad category regex cannot damage those
    configured formats. The category regex then removes provider-group-specific
    additions. A release year is removed from the title because TMDB receives
    it in a dedicated parameter.
    """
    result = str(display_name or name or "").strip()
    for rule in normalize_title_rules(rules or []):
        if not rule["enabled"]:
            continue
        value = rule["value"]
        if result.startswith(value):
            result = result[len(value):].lstrip()
    result = _remove_configured_year(result, year=year, rules=year_rules)
    if normalize_group_title_cleanup(group_rule):
        result = _apply_group_title_cleanup(result, group_rule)
    return re.sub(r"\s+", " ", result).strip()
