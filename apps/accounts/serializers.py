import json
import re

from rest_framework import serializers
from django.contrib.auth.models import Group, Permission
from .models import User
from apps.channels.models import ChannelProfile


# Valid navigation item IDs for validation
VALID_NAV_ITEM_IDS = {
    'channels', 'vods', 'sources', 'guide', 'dvr',
    'stats', 'plugins', 'integrations', 'system', 'settings'
}
MAX_CUSTOM_PROPS_SIZE = 102400  # 100KB limit
SAFE_CREDENTIAL_RE = re.compile(r"^[A-Za-z0-9._@-]+$")


def validate_nav_array(value, field_name):
    """Validate that a value is an array of valid nav item ID strings."""
    if not isinstance(value, list):
        raise serializers.ValidationError(f"{field_name} must be an array")
    if len(value) > 50:
        raise serializers.ValidationError(f"{field_name} exceeds maximum length of 50 items")
    for item in value:
        if not isinstance(item, str):
            raise serializers.ValidationError(f"{field_name} items must be strings")
        if item not in VALID_NAV_ITEM_IDS:
            raise serializers.ValidationError(f"'{item}' is not a valid navigation item ID")


# 🔹 Fix for Permission serialization
class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ["id", "name", "codename"]


# 🔹 Fix for Group serialization
class GroupSerializer(serializers.ModelSerializer):
    permissions = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Permission.objects.all()
    )  # ✅ Fixes ManyToManyField `_meta` error

    class Meta:
        model = Group
        fields = ["id", "name", "permissions"]


# 🔹 Fix for User serialization
class UserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False)
    channel_profiles = serializers.PrimaryKeyRelatedField(
        queryset=ChannelProfile.objects.all(), many=True, required=False
    )
    api_key = serializers.CharField(read_only=True, allow_null=True)
    vod_policy = serializers.SerializerMethodField()
    vod_policy_settings = serializers.JSONField(write_only=True, required=False)

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "api_key",
            "email",
            "user_level",
            "password",
            "channel_profiles",
            "custom_properties",
            "avatar_config",
            "stream_limit",
            "is_staff",
            "is_superuser",
            "last_login",
            "date_joined",
            "first_name",
            "last_name",
            "vod_policy",
            "vod_policy_settings",
        ]

    def get_vod_policy(self, obj):
        from apps.vod.models import VODAccessPolicy

        prefetched = getattr(obj, "_prefetched_objects_cache", {}).get(
            "vod_access_policies"
        )
        if prefetched is None:
            assigned = list(
                obj.vod_access_policies.filter(is_active=True).order_by("id")[:1]
            )
        else:
            assigned = sorted(
                (policy for policy in prefetched if policy.is_active),
                key=lambda policy: policy.id,
            )[:1]
        if assigned:
            policy = assigned[0]
            inherited = False
        else:
            if not hasattr(self, "_default_vod_policy"):
                self._default_vod_policy = (
                    VODAccessPolicy.objects.filter(is_active=True, is_default=True)
                    .order_by("id")
                    .first()
                )
            policy = self._default_vod_policy
            inherited = policy is not None
        if not policy:
            return None
        return {
            "id": policy.id,
            "name": policy.name,
            "export_mode": policy.export_mode,
            "hard_constraints": policy.hard_constraints or {},
            "ranking": policy.ranking or [],
            "inherited": inherited,
        }

    def validate_vod_policy_settings(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Must be an object")
        from apps.vod.models import VODAccessPolicy
        from apps.vod.serializers import VODAccessPolicySerializer

        export_mode = value.get("export_mode", VODAccessPolicy.ExportMode.COMPACT)
        if export_mode not in VODAccessPolicy.ExportMode.values:
            raise serializers.ValidationError({"export_mode": "Unsupported mode"})
        validator = VODAccessPolicySerializer()
        constraints = validator.validate_hard_constraints(
            value.get("hard_constraints", {})
        )
        ranking = validator.validate_ranking(
            value.get(
                "ranking",
                ["audio_language", "subtitle_language", "resolution"],
            )
        )
        return {
            "export_mode": export_mode,
            "hard_constraints": constraints,
            "ranking": ranking,
        }

    def _save_vod_policy(self, user, settings):
        if settings is None:
            return
        from apps.vod.models import VODAccessPolicy

        assigned = (
            user.vod_access_policies.filter(is_active=True).order_by("id").first()
        )
        shared = bool(
            assigned
            and (
                assigned.is_default
                or assigned.users.exclude(pk=user.pk).exists()
            )
        )
        if assigned is None or shared:
            assigned, _created = VODAccessPolicy.objects.get_or_create(
                name=f"VOD preferences — user {user.pk}",
                defaults={"is_active": True, "is_default": False},
            )
        for other in VODAccessPolicy.objects.exclude(pk=assigned.pk).filter(users=user):
            other.users.remove(user)
        assigned.export_mode = settings["export_mode"]
        assigned.hard_constraints = settings["hard_constraints"]
        assigned.ranking = settings["ranking"]
        assigned.is_active = True
        assigned.save(
            update_fields=[
                "export_mode", "hard_constraints", "ranking", "is_active", "updated_at"
            ]
        )
        assigned.users.add(user)

    def validate_username(self, value):
        if not SAFE_CREDENTIAL_RE.fullmatch(value):
            raise serializers.ValidationError(
                "Username may only contain letters, numbers, periods (.), underscores (_), at signs (@), and hyphens (-)"
            )
        return value

    def validate_custom_properties(self, value):
        """Validate custom_properties structure and size."""
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("custom_properties must be a dictionary")

        # Size limit check
        try:
            if len(json.dumps(value)) > MAX_CUSTOM_PROPS_SIZE:
                raise serializers.ValidationError(
                    f"custom_properties exceeds maximum size of {MAX_CUSTOM_PROPS_SIZE} bytes"
                )
        except (TypeError, ValueError):
            raise serializers.ValidationError("custom_properties contains non-serializable data")

        # Validate navOrder if present
        if 'navOrder' in value:
            validate_nav_array(value['navOrder'], 'navOrder')

        # Validate hiddenNav if present
        if 'hiddenNav' in value:
            validate_nav_array(value['hiddenNav'], 'hiddenNav')

        xc_password = value.get("xc_password")

        if xc_password and not SAFE_CREDENTIAL_RE.fullmatch(xc_password):
            raise serializers.ValidationError(
                "XC password may only contain letters, numbers, periods (.), underscores (_), at signs (@), and hyphens (-)"
            )
            
        return value

    def create(self, validated_data):
        channel_profiles = validated_data.pop("channel_profiles", [])
        vod_policy_settings = validated_data.pop("vod_policy_settings", None)

        user = User(**validated_data)
        user.set_password(validated_data["password"])
        user.save()

        user.channel_profiles.set(channel_profiles)
        self._save_vod_policy(user, vod_policy_settings)

        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        channel_profiles = validated_data.pop("channel_profiles", None)
        vod_policy_settings = validated_data.pop("vod_policy_settings", None)

        # Merge custom_properties instead of replacing (prevents data loss)
        # null values are explicit deletions; all other values overwrite existing
        custom_properties = validated_data.pop("custom_properties", None)
        if custom_properties is not None:
            existing = instance.custom_properties or {}
            merged = dict(existing)
            for k, v in custom_properties.items():
                if v is None:
                    merged.pop(k, None)
                else:
                    merged[k] = v
            # Scrub stale nav IDs so the DB self-heals on next save
            for nav_field in ('navOrder', 'hiddenNav'):
                if nav_field in merged and isinstance(merged[nav_field], list):
                    merged[nav_field] = [
                        item for item in merged[nav_field]
                        if item in VALID_NAV_ITEM_IDS
                    ]
            instance.custom_properties = merged

        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        if password:
            instance.set_password(password)

        instance.save()

        if channel_profiles is not None:
            instance.channel_profiles.set(channel_profiles)

        self._save_vod_policy(instance, vod_policy_settings)

        return instance
