"""Admin API for the VOD profiles that shape Xtream Codes output per user."""

from django.contrib.auth import get_user_model
from django.db.models import Prefetch
from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.accounts.permissions import IsAdmin
from apps.m3u.models import M3UAccount
from . import profile_catalog, profiles
from .models import VODList, VODProfile, VODProfileAssignment
from .profile_serializers import (
    VODProfileDraftSerializer,
    VODProfileEditionCountsSerializer,
    VODProfileOptionsSerializer,
    VODProfilePreviewRequestSerializer,
    VODProfilePreviewSerializer,
    VODProfileSerializer,
    VODProfileValuesSerializer,
)


class VODProfileViewSet(viewsets.ModelViewSet):
    serializer_class = VODProfileSerializer
    permission_classes = [IsAdmin]
    pagination_class = None

    def get_queryset(self):
        profiles.default_profile()
        return VODProfile.objects.prefetch_related(
            Prefetch(
                "assignments", queryset=VODProfileAssignment.objects.only("user_id")
            ),
            "list_links",
        )

    def perform_destroy(self, instance):
        if instance.is_default:
            raise ValidationError(
                {"detail": "Make another profile the default before deleting it."}
            )
        instance.delete()

    @extend_schema(request=None, responses=VODProfileSerializer)
    @action(detail=True, methods=["post"])
    def rebuild(self, request, pk=None):
        profile = self.get_object()
        if not profile.is_active:
            raise ValidationError({"detail": "Activate the profile first."})
        if profile.catalog_status != VODProfile.CatalogStatus.BUILDING:
            profile.catalog_status = VODProfile.CatalogStatus.PENDING
            profile.save(update_fields=["catalog_status"])
        profile_catalog.request_catalog_build([profile.pk], countdown=0)
        return Response(self.get_serializer(profile).data)

    @extend_schema(responses=VODProfileOptionsSerializer)
    @action(detail=False, methods=["get"])
    def options(self, request):
        from .library import library_settings

        users = get_user_model().objects.order_by("username")
        return Response(
            VODProfileOptionsSerializer(
                {
                    "users": users.values("id", "username"),
                    "accounts": M3UAccount.objects.filter(
                        category_relations__isnull=False
                    )
                    .distinct()
                    .order_by("name")
                    .values("id", "name"),
                    "metadata_languages": library_settings()["languages"],
                    "lists": VODList.objects.values(
                        "id", "name", "list_type", "content_type", "is_enabled"
                    ),
                }
            ).data
        )

    @extend_schema(responses=VODProfileValuesSerializer)
    @action(detail=False, methods=["get"])
    def values(self, request):
        """Languages, resolutions and features a profile can choose.

        Read from every source, so they come apart from the quick options.
        """
        return Response(VODProfileValuesSerializer(profiles.option_values()).data)

    @extend_schema(
        parameters=[VODProfilePreviewRequestSerializer],
        responses=VODProfilePreviewSerializer,
    )
    @action(detail=True, methods=["get"])
    def preview(self, request, pk=None):
        """The titles of the built catalogue, as clients receive them."""
        profile = self.get_object()
        if not profile.catalog_generation:
            raise ValidationError(
                {"detail": "The catalogue is available once it has been built."}
            )
        serializer = VODProfilePreviewRequestSerializer(data=request.query_params)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        result = profile_catalog.preview(
            profile,
            data["content_type"],
            search=data.get("search", ""),
            excluded=data["excluded"],
            account=data.get("account"),
            category=data.get("category"),
            edition=data.get("edition"),
            page=data["page"],
            page_size=data["page_size"],
        )
        return Response(VODProfilePreviewSerializer(result).data)

    @extend_schema(
        request=VODProfileDraftSerializer,
        responses=VODProfileEditionCountsSerializer,
    )
    @action(detail=False, methods=["post"], url_path="edition-counts")
    def edition_counts(self, request):
        """Offered titles per edition of unsaved settings."""
        serializer = VODProfileDraftSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        settings = dict(data["profile"])
        lists = settings.pop("lists", None)
        profile = VODProfile(**settings)
        if lists is not None:
            profile.draft_list_ids = lists
        return Response(
            VODProfileEditionCountsSerializer(
                profile_catalog.edition_counts(profile)
            ).data
        )
