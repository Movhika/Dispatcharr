"""Admin API for the VOD profiles that shape Xtream Codes output per user."""

from django.db.models import Prefetch
from rest_framework import viewsets
from rest_framework.exceptions import ValidationError

from apps.accounts.permissions import IsAdmin

from . import profiles
from .models import VODProfile, VODProfileAssignment
from .profile_serializers import VODProfileSerializer


class VODProfileViewSet(viewsets.ModelViewSet):
    serializer_class = VODProfileSerializer
    permission_classes = [IsAdmin]
    pagination_class = None

    def get_queryset(self):
        profiles.default_profile()
        return VODProfile.objects.prefetch_related(
            Prefetch(
                "assignments", queryset=VODProfileAssignment.objects.only("user_id")
            )
        )

    def perform_destroy(self, instance):
        if instance.is_default:
            raise ValidationError(
                {"detail": "Make another profile the default before deleting it."}
            )
        instance.delete()
