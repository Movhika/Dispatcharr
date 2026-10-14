"""Read-only, complete ordered-draft previews and explicit application."""

from collections import defaultdict

import regex
from django.db import transaction
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.permissions import IsAdmin
from apps.channels.models import ChannelGroupM3UAccount, Stream
from apps.vod.models import M3UMovieRelation, M3USeriesRelation, M3UVODCategoryRelation

from .filter_catalog import (
    has_live_filter_catalog,
    iter_live_filter_catalog,
    live_filter_catalog_timestamp,
)
from .group_rules import (
    compile_group_rules,
    evaluate_group_rules,
    REGEX_TIMEOUT_SECONDS,
)
from .models import M3UAccount, M3UFilter, M3UGroupRule
from .serializers import (
    M3UFilterPreviewRequestSerializer,
    M3UGroupRulePreviewRequestSerializer,
    M3UGroupRuleSerializer,
    M3UGroupContentQuerySerializer,
    M3UGroupContentAvailabilitySerializer,
    M3UPreviewResponseSerializer,
    M3URuleApplyResponseSerializer,
    M3URuleOrderSerializer,
)

PREVIEW_PARAMETERS = [
    OpenApiParameter("page", int, description="Page number, starting at 1."),
    OpenApiParameter("page_size", int, description="Rows per page, from 1 to 100."),
]


def _pagination(request):
    try:
        page = int(request.query_params.get("page", 1))
        page_size = int(request.query_params.get("page_size", 50))
    except (ValueError, TypeError) as exc:
        raise serializers.ValidationError("Invalid pagination.") from exc
    if page < 1 or not 1 <= page_size <= 100:
        raise serializers.ValidationError(
            "page must be positive and page_size between 1 and 100."
        )
    return page, page_size


def _draft_rows(request, serializer_class, model):
    serializer = serializer_class(data=request.data)
    serializer.is_valid(raise_exception=True)
    target_id = serializer.validated_data["target_id"]
    rows = []
    ids = set()
    for values in serializer.validated_data["rules"]:
        values = dict(values)
        preview_id = values.pop("preview_id")
        values.pop("id", None)
        if preview_id in ids:
            raise serializers.ValidationError("Draft rule IDs must be unique.")
        ids.add(preview_id)
        row = model(**values)
        row.id = preview_id
        rows.append(row)
    if target_id not in ids:
        raise serializers.ValidationError(
            "The selected rule is missing from the draft."
        )
    rows.sort(key=lambda row: row.order)
    return rows, target_id


def _paged_matches(matches, page, page_size):
    start = (page - 1) * page_size
    end = start + page_size
    count = 0
    results = []
    for match in matches:
        if start <= count < end:
            results.append(match)
        count += 1
    return {"count": count, "results": results, "page": page, "page_size": page_size}


def _reorder(queryset, request):
    serializer = M3URuleOrderSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    ids = serializer.validated_data["ids"]
    positions = serializer.validated_data.get("positions", list(range(len(ids))))
    if len(positions) != len(ids) or len(set(positions)) != len(positions):
        raise serializers.ValidationError("Provide one unique position per saved rule.")
    if len(set(ids)) != len(ids):
        raise serializers.ValidationError("Rule IDs must be unique.")
    with transaction.atomic():
        rows = list(queryset.select_for_update())
        by_id = {row.id: row for row in rows}
        if set(ids) != set(by_id):
            raise serializers.ValidationError(
                "Include exactly the saved rules for this account and scope."
            )
        for position, row_id in zip(positions, ids):
            by_id[row_id].order = position
        queryset.model.objects.bulk_update(rows, ["order"])
    return Response(M3URuleApplyResponseSerializer({"updated": len(rows)}).data)


def _imported_live_inventory(account_id):
    for stream in (
        Stream.objects.filter(m3u_account_id=account_id)
        .select_related("channel_group")
        .order_by("id")
        .iterator(chunk_size=2000)
    ):
        yield {
            "name": stream.name,
            "group": stream.channel_group.name if stream.channel_group else "",
            "url": stream.url or "",
        }


class StreamFilterPreviewMixin:
    @extend_schema(
        request=M3UFilterPreviewRequestSerializer,
        responses=M3UPreviewResponseSerializer,
        parameters=PREVIEW_PARAMETERS,
    )
    @action(
        detail=False,
        methods=["post"],
        url_path="preview-draft",
        permission_classes=[IsAdmin],
    )
    def preview_draft(self, request, *args, **kwargs):
        account = get_object_or_404(M3UAccount, pk=self.kwargs["account_id"])
        page, page_size = _pagination(request)
        rows, target_id = _draft_rows(
            request, M3UFilterPreviewRequestSerializer, M3UFilter
        )
        compiled = [
            (
                row,
                regex.compile(
                    row.regex_pattern,
                    (
                        0
                        if (row.custom_properties or {}).get("case_sensitive", True)
                        else regex.IGNORECASE
                    ),
                ),
            )
            for row in rows
        ]
        complete = has_live_filter_catalog(account.id)
        inventory = (
            iter_live_filter_catalog(account.id)
            if complete
            else _imported_live_inventory(account.id)
        )
        inventory_count = 0

        def matches():
            nonlocal inventory_count
            for stream in inventory:
                inventory_count += 1
                for row, pattern in compiled:
                    key = {"name": "name", "group": "group", "url": "url"}[
                        row.filter_type
                    ]
                    if not pattern.search(
                        stream.get(key) or "", timeout=REGEX_TIMEOUT_SECONDS
                    ):
                        continue
                    if row.id == target_id:
                        yield {
                            "name": stream.get("name") or "",
                            "group": stream.get("group") or "",
                            "result": "exclude" if row.exclude else "include",
                        }
                    break

        try:
            response = _paged_matches(matches(), page, page_size)
        except TimeoutError as exc:
            raise serializers.ValidationError(
                "A regular expression took too long. Simplify it and retry."
            ) from exc
        except (OSError, ValueError) as exc:
            raise serializers.ValidationError(
                "The saved preview catalog is unavailable. Run a Live refresh and retry."
            ) from exc
        response.update(
            {
                "inventory_count": inventory_count,
                "catalog_complete": complete,
                "last_completed_refresh": (
                    live_filter_catalog_timestamp(account.id)
                    if complete
                    else account.updated_at
                ),
                "refresh_in_progress": account.status
                in (M3UAccount.Status.FETCHING, M3UAccount.Status.PARSING),
            }
        )
        return Response(M3UPreviewResponseSerializer(response).data)

    @extend_schema(
        request=M3URuleOrderSerializer, responses=M3URuleApplyResponseSerializer
    )
    @action(detail=False, methods=["post"], permission_classes=[IsAdmin])
    def reorder(self, request, *args, **kwargs):
        return _reorder(self.get_queryset(), request)


class M3UGroupRuleViewSet(viewsets.ModelViewSet):
    queryset = M3UGroupRule.objects.all()
    serializer_class = M3UGroupRuleSerializer
    permission_classes = [IsAdmin]
    pagination_class = None

    def get_queryset(self):
        account_id = self.kwargs.get("account_id")
        if account_id is None:
            return self.queryset.none()
        queryset = self.queryset.filter(m3u_account_id=account_id)
        scope = self.request.query_params.get("scope")
        return queryset.filter(scope=scope) if scope else queryset

    def perform_create(self, serializer):
        account = get_object_or_404(M3UAccount, pk=self.kwargs["account_id"])
        serializer.save(m3u_account=account)

    @extend_schema(
        description="List category IDs with imported content for this account. Read-only; does not contact the provider or import anything.",
        responses=M3UGroupContentAvailabilitySerializer,
    )
    @action(
        detail=False,
        methods=["get"],
        url_path="content-availability",
        permission_classes=[IsAdmin],
    )
    def content_availability(self, request, *args, **kwargs):
        account = get_object_or_404(M3UAccount, pk=self.kwargs["account_id"])
        available = {
            "live": list(
                Stream.objects.filter(m3u_account=account)
                .exclude(channel_group_id=None)
                .order_by("channel_group_id")
                .values_list("channel_group_id", flat=True)
                .distinct()
            )
        }
        for scope, model in (
            (M3UGroupRule.Scope.MOVIE, M3UMovieRelation),
            (M3UGroupRule.Scope.SERIES, M3USeriesRelation),
        ):
            available[scope] = list(
                model.objects.filter(m3u_account=account, category__category_type=scope)
                .order_by("category_id")
                .values_list("category_id", flat=True)
                .distinct()
            )
        return Response(M3UGroupContentAvailabilitySerializer(available).data)

    @extend_schema(
        parameters=PREVIEW_PARAMETERS + [M3UGroupContentQuerySerializer],
        responses=M3UPreviewResponseSerializer,
    )
    @action(
        detail=False,
        methods=["get"],
        url_path="content-preview",
        permission_classes=[IsAdmin],
    )
    def content_preview(self, request, *args, **kwargs):
        account = get_object_or_404(M3UAccount, pk=self.kwargs["account_id"])
        query = M3UGroupContentQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        scope = query.validated_data["scope"]
        group_id = query.validated_data["group_id"]
        search = query.validated_data.get("search", "")
        page, page_size = _pagination(request)
        if scope == M3UGroupRule.Scope.LIVE:
            get_object_or_404(
                ChannelGroupM3UAccount, m3u_account=account, channel_group_id=group_id
            )
            queryset = Stream.objects.filter(
                m3u_account=account, channel_group_id=group_id
            )
            title_field = "name"
        else:
            get_object_or_404(
                M3UVODCategoryRelation,
                m3u_account=account,
                category_id=group_id,
                category__category_type=scope,
            )
            model = (
                M3UMovieRelation
                if scope == M3UGroupRule.Scope.MOVIE
                else M3USeriesRelation
            )
            title_field = (
                "movie__name" if scope == M3UGroupRule.Scope.MOVIE else "series__name"
            )
            queryset = model.objects.filter(m3u_account=account, category_id=group_id)
        if search:
            queryset = queryset.filter(**{f"{title_field}__icontains": search})
        count = queryset.count()
        start = (page - 1) * page_size
        results = [
            {"relation_id": row_id, "name": name}
            for row_id, name in queryset.order_by(title_field, "id").values_list(
                "id", title_field
            )[start : start + page_size]
        ]
        return Response(
            M3UPreviewResponseSerializer(
                {
                    "count": count,
                    "results": results,
                    "page": page,
                    "page_size": page_size,
                }
            ).data
        )

    def _matches(self, account, rules, target_id, scope):
        compiled = compile_group_rules(rules)
        item_names = defaultdict(list)
        if scope == M3UGroupRule.Scope.LIVE:
            relations = (
                ChannelGroupM3UAccount.objects.filter(m3u_account=account)
                .select_related("channel_group")
                .order_by("id")
            )
            names = Stream.objects.filter(m3u_account=account).values_list(
                "channel_group_id", "name"
            )
            name_field = "channel_group"
            key_field = "channel_group_id"
        else:
            relations = (
                M3UVODCategoryRelation.objects.filter(
                    m3u_account=account, category__category_type=scope
                )
                .select_related("category")
                .order_by("id")
            )
            model = (
                M3UMovieRelation
                if scope == M3UGroupRule.Scope.MOVIE
                else M3USeriesRelation
            )
            title_field = (
                "movie__name" if scope == M3UGroupRule.Scope.MOVIE else "series__name"
            )
            names = model.objects.filter(m3u_account=account).values_list(
                "category_id", title_field
            )
            name_field = "category"
            key_field = "category_id"
        catalog_scope = "live-groups" if scope == M3UGroupRule.Scope.LIVE else scope
        complete = has_live_filter_catalog(account.id, catalog_scope)
        if complete:
            try:
                for row in iter_live_filter_catalog(account.id, catalog_scope):
                    item_names[row["group"]].append(row["name"])
            except (OSError, ValueError) as exc:
                raise serializers.ValidationError(
                    "The saved import catalog is unavailable. Run a refresh and retry."
                ) from exc
        else:
            for key, name in names.iterator(chunk_size=2000):
                item_names[key].append(name)
        for relation in relations.iterator(chunk_size=2000):
            name = getattr(relation, name_field).name
            items = item_names[name if complete else getattr(relation, key_field)]
            decision = evaluate_group_rules(compiled, group_name=name, item_names=items)
            if decision.matched_rule_id == target_id:
                yield {
                    "relation_id": relation.id,
                    "name": name,
                    "target_id": getattr(relation, key_field),
                    "currently_enabled": relation.enabled,
                    "would_enable": None if decision.ignored else decision.enabled,
                    "action": decision.action,
                    "item_count": len(items),
                }

    @extend_schema(
        request=M3UGroupRulePreviewRequestSerializer,
        responses=M3UPreviewResponseSerializer,
        parameters=PREVIEW_PARAMETERS,
    )
    @action(
        detail=False,
        methods=["post"],
        url_path="preview-draft",
        permission_classes=[IsAdmin],
    )
    def preview_draft(self, request, *args, **kwargs):
        account = get_object_or_404(M3UAccount, pk=self.kwargs["account_id"])
        page, page_size = _pagination(request)
        rows, target_id = _draft_rows(
            request, M3UGroupRulePreviewRequestSerializer, M3UGroupRule
        )
        scopes = {row.scope for row in rows}
        if len(scopes) != 1:
            raise serializers.ValidationError(
                "All draft rules must use the same content scope."
            )
        scope = scopes.pop()
        try:
            response = _paged_matches(
                self._matches(account, rows, target_id, scope), page, page_size
            )
        except TimeoutError as exc:
            raise serializers.ValidationError(
                "A regular expression took too long. Simplify it and retry."
            ) from exc
        catalog_scope = "live-groups" if scope == M3UGroupRule.Scope.LIVE else scope
        response["catalog_complete"] = has_live_filter_catalog(account.id, catalog_scope)
        return Response(M3UPreviewResponseSerializer(response).data)

    @extend_schema(request=None, responses=M3URuleApplyResponseSerializer)
    @action(detail=True, methods=["post"], permission_classes=[IsAdmin])
    def apply(self, request, *args, **kwargs):
        rule = self.get_object()
        if rule.action == M3UGroupRule.Action.IGNORE:
            raise serializers.ValidationError(
                "Ignore prevents future discovery; existing entries are never deleted."
            )
        rules = list(
            rule.m3u_account.group_rules.filter(scope=rule.scope).order_by(
                "order", "id"
            )
        )
        try:
            matches = list(self._matches(rule.m3u_account, rules, rule.id, rule.scope))
            ids = [row["relation_id"] for row in matches]
        except TimeoutError as exc:
            raise serializers.ValidationError(
                "A regular expression took too long. Nothing was applied."
            ) from exc
        model = (
            ChannelGroupM3UAccount
            if rule.scope == M3UGroupRule.Scope.LIVE
            else M3UVODCategoryRelation
        )
        updated = model.objects.filter(id__in=ids, m3u_account=rule.m3u_account).update(
            enabled=rule.action == M3UGroupRule.Action.ENABLE
        )
        return Response(
            M3URuleApplyResponseSerializer(
                {
                    "updated": updated,
                    "scope": rule.scope,
                    "enabled": rule.action == M3UGroupRule.Action.ENABLE,
                    "target_ids": [row["target_id"] for row in matches],
                }
            ).data
        )

    @extend_schema(
        request=M3UGroupRulePreviewRequestSerializer,
        responses=M3URuleApplyResponseSerializer,
    )
    @action(
        detail=False,
        methods=["post"],
        url_path="save-apply",
        permission_classes=[IsAdmin],
    )
    def save_apply(self, request, *args, **kwargs):
        account = get_object_or_404(M3UAccount, pk=self.kwargs["account_id"])
        rows, target_id = _draft_rows(
            request, M3UGroupRulePreviewRequestSerializer, M3UGroupRule
        )
        scopes = {row.scope for row in rows}
        if len(scopes) != 1:
            raise serializers.ValidationError(
                "All draft rules must use the same scope."
            )
        scope = scopes.pop()
        target = next(row for row in rows if row.id == target_id)
        if target.action == M3UGroupRule.Action.IGNORE:
            raise serializers.ValidationError(
                "Ignore prevents future imports; existing entries are never deleted."
            )
        with transaction.atomic():
            existing = {
                rule.id: rule
                for rule in account.group_rules.select_for_update().filter(scope=scope)
            }
            saved_ids = {int(row.id) for row in rows if row.id.isdigit()}
            if saved_ids != set(existing):
                raise serializers.ValidationError(
                    "The saved rules changed. Reload them and preview again."
                )
            saved_rows = []
            saved_target = None
            for row in rows:
                instance = existing.get(int(row.id)) if row.id.isdigit() else None
                values = {
                    field: getattr(row, field)
                    for field in M3UGroupRuleSerializer.Meta.fields
                    if field != "id"
                }
                serializer = M3UGroupRuleSerializer(instance, data=values)
                serializer.is_valid(raise_exception=True)
                saved = serializer.save(m3u_account=account)
                saved_rows.append(saved)
                if row.id == target_id:
                    saved_target = saved
            try:
                matches = list(
                    self._matches(account, saved_rows, saved_target.id, scope)
                )
                ids = [match["relation_id"] for match in matches]
            except TimeoutError as exc:
                raise serializers.ValidationError(
                    "A regular expression took too long. Nothing was saved or applied."
                ) from exc
            model = (
                ChannelGroupM3UAccount
                if scope == M3UGroupRule.Scope.LIVE
                else M3UVODCategoryRelation
            )
            updated = model.objects.filter(id__in=ids, m3u_account=account).update(
                enabled=saved_target.action == M3UGroupRule.Action.ENABLE
            )
        return Response(
            M3URuleApplyResponseSerializer(
                {
                    "updated": updated,
                    "scope": scope,
                    "enabled": saved_target.action == M3UGroupRule.Action.ENABLE,
                    "target_ids": [row["target_id"] for row in matches],
                }
            ).data
        )

    @extend_schema(
        request=M3URuleOrderSerializer, responses=M3URuleApplyResponseSerializer
    )
    @action(detail=False, methods=["post"], permission_classes=[IsAdmin])
    def reorder(self, request, *args, **kwargs):
        serializer = M3URuleOrderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        scope = serializer.validated_data.get("scope")
        if not scope:
            raise serializers.ValidationError("scope is required.")
        return _reorder(self.get_queryset().filter(scope=scope), request)
