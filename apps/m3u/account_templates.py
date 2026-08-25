"""Portable M3U account template capture and application helpers."""

from django.db import transaction

from .models import M3UAccountTemplate, M3UFilter, M3UGroupRule


ACCOUNT_SETTING_FIELDS = (
    "max_streams",
    "refresh_interval",
    "stale_stream_days",
    "priority",
)
CUSTOM_SETTING_FIELDS = (
    "enable_vod",
    "use_group_rules_live",
    "use_group_rules_movie",
    "use_group_rules_series",
)


def capture_account_template(account, *, name, description=""):
    custom = account.custom_properties or {}
    settings = {
        field: getattr(account, field) for field in ACCOUNT_SETTING_FIELDS
    }
    settings.update(
        {field: custom.get(field, field.startswith("use_group_rules_")) for field in CUSTOM_SETTING_FIELDS}
    )
    filters = list(
        account.filters.order_by("order", "id").values(
            "filter_type", "regex_pattern", "exclude", "order", "custom_properties"
        )
    )
    rules = list(
        account.group_rules.order_by("scope", "order", "id").values(
            "scope",
            "match_field",
            "match_mode",
            "regex_pattern",
            "exclude_regex_pattern",
            "action",
            "case_sensitive",
            "enabled",
            "metadata_defaults",
            "order",
        )
    )
    return M3UAccountTemplate.objects.create(
        name=name,
        description=description,
        account_type=account.account_type,
        account_settings=settings,
        filters=filters,
        group_rules=rules,
    )


@transaction.atomic
def apply_account_template(account, template):
    settings = template.account_settings or {}
    update_fields = []
    account.account_type = template.account_type
    update_fields.append("account_type")
    for field in ACCOUNT_SETTING_FIELDS:
        if field in settings:
            setattr(account, field, settings[field])
            update_fields.append(field)
    custom = dict(account.custom_properties or {})
    for field in CUSTOM_SETTING_FIELDS:
        if field in settings:
            custom[field] = settings[field]
    account.custom_properties = custom
    update_fields.append("custom_properties")
    account.save(update_fields=list(dict.fromkeys(update_fields)))

    account.filters.all().delete()
    M3UFilter.objects.bulk_create(
        [M3UFilter(m3u_account=account, **values) for values in (template.filters or [])]
    )
    account.group_rules.all().delete()
    M3UGroupRule.objects.bulk_create(
        [
            M3UGroupRule(m3u_account=account, **values)
            for values in (template.group_rules or [])
        ]
    )
    return account
