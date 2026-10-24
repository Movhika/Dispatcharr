"""Shared first-match evaluation for imports and previews."""

from dataclasses import dataclass, field

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
    metadata_defaults: dict = field(default_factory=dict)

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
        if (
            rule.enabled and not rule.requires_review
            and rule.match_field == M3UGroupRule.MatchField.GROUP_NAME
            and rule.match_mode == M3UGroupRule.MatchMode.ANY
        )
    ]


def account_group_rules(account, scope):
    return compile_group_rules(
        account.group_rules.filter(scope=scope, enabled=True).order_by("order", "id")
    )


def evaluate_group_rules(compiled_rules, *, group_name, default_enabled=False):
    """The first matching rule decides the import result and all its metadata."""
    for rule, pattern in compiled_rules:
        if rule.action == M3UGroupRule.Action.KEEP:
            continue
        if pattern.search(group_name or "", timeout=REGEX_TIMEOUT_SECONDS):
            metadata = dict(rule.metadata_defaults or {})
            return GroupRuleDecision(
                rule.action,
                rule.action == M3UGroupRule.Action.ENABLE,
                rule.id,
                metadata,
            )
    action = (
        M3UGroupRule.Action.ENABLE if default_enabled else M3UGroupRule.Action.DISABLE
    )
    return GroupRuleDecision(action, action == M3UGroupRule.Action.ENABLE)
