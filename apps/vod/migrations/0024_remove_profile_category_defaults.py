import re

from django.db import migrations


def _rule_matches(rule, relation):
    if not isinstance(rule, dict) or rule.get("enabled", True) is False:
        return False
    if str(rule.get("scope") or "") != relation["category__category_type"]:
        return False
    account_id = rule.get("m3u_account_id")
    if account_id is not None and account_id != "":
        try:
            if int(account_id) != relation["m3u_account_id"]:
                return False
        except (TypeError, ValueError):
            return False
    flags = 0 if rule.get("case_sensitive") else re.IGNORECASE
    try:
        expression = re.compile(str(rule.get("regex_pattern") or ""), flags)
    except re.error:
        return False
    return bool(expression.search(str(relation["category__name"] or "")))


def preserve_existing_category_decisions(apps, schema_editor):
    policy_model = apps.get_model("vod", "VODAccessPolicy")
    relation_model = apps.get_model("vod", "M3UVODCategoryRelation")
    decision_model = apps.get_model("vod", "VODPolicyCategory")

    relations = list(
        relation_model.objects.filter(
            enabled=True,
            m3u_account__is_active=True,
        ).values(
            "id",
            "m3u_account_id",
            "category__name",
            "category__category_type",
        )
    )

    for policy in policy_model.objects.all().iterator(chunk_size=100):
        constraints = dict(policy.hard_constraints or {})
        defaults = constraints.pop("category_default_actions", None)
        if defaults is None:
            continue

        rules = list(constraints.get("category_import_rules") or [])
        existing = set(
            decision_model.objects.filter(policy_id=policy.pk).values_list(
                "category_relation_id", flat=True
            )
        )
        decisions = []
        for relation in relations:
            if relation["id"] in existing:
                continue
            matched = next(
                (rule for rule in rules if _rule_matches(rule, relation)),
                None,
            )
            if matched is not None:
                continue
            scope = relation["category__category_type"]
            if defaults.get(scope, "enable") != "enable":
                continue
            decisions.append(
                decision_model(
                    policy_id=policy.pk,
                    category_relation_id=relation["id"],
                    enabled=True,
                    priority=0,
                )
            )
        decision_model.objects.bulk_create(decisions, batch_size=1000)

        # Presence of this list selects the dynamic profile resolver. Its
        # fixed fallback now blocks future categories that match no rule.
        constraints.setdefault("category_import_rules", rules)
        policy.hard_constraints = constraints
        policy.save(update_fields=["hard_constraints"])


class Migration(migrations.Migration):
    dependencies = [
        ("vod", "0023_vod_effective_title_trigram_indexes"),
    ]

    operations = [
        migrations.RunPython(
            preserve_existing_category_decisions,
            migrations.RunPython.noop,
        ),
    ]
