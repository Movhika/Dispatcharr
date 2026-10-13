"""Shared first-match evaluation for imports and previews."""

from dataclasses import dataclass

import regex

from .models import M3UGroupRule

REGEX_TIMEOUT_SECONDS = 0.1


class CategoryImportMap(dict):
    """Category lookup with explicit exclusions and an optional fetched catalog."""

    def __init__(self, *args, ignored=(), catalog=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.ignored = set(ignored)
        self.catalog = catalog
        self.group_names = {}
        self.catalog_stage = None


@dataclass(frozen=True)
class GroupRuleDecision:
    action: str
    enabled: bool
    matched_rule_id: int | str | None = None

    @property
    def ignored(self):
        return self.action == M3UGroupRule.Action.IGNORE


def compile_group_rules(rules):
    return [
        (
            rule,
            regex.compile(
                rule.regex_pattern,
                0 if rule.case_sensitive else regex.IGNORECASE,
            ),
        )
        for rule in rules
        if rule.enabled
    ]


def account_group_rules(account, scope):
    return compile_group_rules(
        account.group_rules.filter(scope=scope, enabled=True).order_by("order", "id")
    )


def evaluate_group_rules(
    compiled_rules, *, group_name, item_names=(), default_enabled=False
):
    for rule, pattern in compiled_rules:
        if rule.match_field == M3UGroupRule.MatchField.GROUP_NAME:
            matched = pattern.search(group_name or "", timeout=REGEX_TIMEOUT_SECONDS)
        elif not item_names:
            matched = False
        else:
            checks = (
                bool(pattern.search(name or "", timeout=REGEX_TIMEOUT_SECONDS))
                for name in item_names
            )
            matched = (
                all(checks)
                if rule.match_mode == M3UGroupRule.MatchMode.ALL
                else any(checks)
            )
        if matched:
            return GroupRuleDecision(
                rule.action, rule.action == M3UGroupRule.Action.ENABLE, rule.id
            )
    return GroupRuleDecision(
        M3UGroupRule.Action.ENABLE if default_enabled else M3UGroupRule.Action.DISABLE,
        default_enabled,
    )
