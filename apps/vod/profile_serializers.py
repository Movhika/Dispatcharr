from django.db import transaction
from rest_framework import serializers

from . import profile_catalog, profiles
from .models import VODList, VODProfile, VODProfileList


class ProfileUsersField(serializers.ListField):
    child = serializers.IntegerField()

    def get_attribute(self, instance):
        return sorted(assignment.user_id for assignment in instance.assignments.all())


class ProfileListsField(serializers.ListField):
    child = serializers.IntegerField(min_value=1)

    def get_attribute(self, instance):
        return [link.vod_list_id for link in instance.list_links.all()]


def _normalized(normalize, value, *args):
    try:
        return normalize(value, *args)
    except profiles.FieldError as error:
        detail = {error.field: [str(error)]}
        if error.index is not None:
            detail = {str(error.index): detail}
        raise serializers.ValidationError(detail)
    except ValueError as error:
        raise serializers.ValidationError(str(error))


class VODProfileSerializer(serializers.ModelSerializer):
    users = ProfileUsersField(
        read_only=True,
        help_text="Users assigned to this profile in their user settings.",
    )
    excluded_titles = serializers.JSONField(
        required=False,
        help_text="Movies and series this profile never offers, by type and ID.",
    )
    content_rules = serializers.JSONField(
        required=False,
        help_text="Ordered rules; the first match includes or excludes a source.",
    )
    lists = ProfileListsField(
        required=False,
        max_length=100,
        help_text="Lists offered as client categories with list output, in order.",
    )

    class Meta:
        model = VODProfile
        fields = (
            "id",
            "name",
            "is_default",
            "is_active",
            "output_mode",
            "output_groups",
            "lists",
            "include_unsorted",
            "name_template",
            "name_labels",
            "title_source",
            "metadata_source",
            "content_rules",
            "excluded_titles",
            "edition_rules",
            "ranking",
            "audio_language_order",
            "subtitle_language_order",
            "provider_order",
            "users",
            "catalog_status",
            "catalog_counts",
            "catalog_progress",
            "catalog_started_at",
            "catalog_completed_at",
            "catalog_error",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "catalog_status",
            "catalog_counts",
            "catalog_progress",
            "catalog_started_at",
            "catalog_completed_at",
            "catalog_error",
            "created_at",
            "updated_at",
        )
        # The single-default constraint is enforced in _save by moving it.
        extra_kwargs = {"is_default": {"validators": []}}

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a profile name.")
        duplicate = VODProfile.objects.filter(name__iexact=value)
        if self.instance is not None:
            duplicate = duplicate.exclude(pk=self.instance.pk)
        if duplicate.exists():
            raise serializers.ValidationError("A profile with this name exists.")
        return value

    def validate_excluded_titles(self, value):
        from .selection import resolve_content

        titles = _normalized(profiles.normalize_excluded_titles, value)
        # Merged titles keep their exclusion; titles that are gone drop out.
        current = set()
        for title in titles:
            content, _ = resolve_content(title["content_type"], title["id"])
            if content is not None:
                current.add((title["content_type"], content.pk))
        return [
            {"content_type": content_type, "id": content_id}
            for content_type, content_id in sorted(current)
        ]

    def validate_name_template(self, value):
        return _normalized(profiles.normalize_name_template, value)

    def validate_name_labels(self, value):
        return _normalized(profiles.normalize_name_labels, value)

    def validate_title_source(self, value):
        from .library import library_settings

        allowed = (
            profiles.PROVIDER_TITLES,
            profiles.CLEAN_TITLES,
            *library_settings()["languages"],
        )
        if value not in allowed:
            raise serializers.ValidationError(
                "Choose provider, clean or a Library metadata language."
            )
        return value

    def validate_content_rules(self, value):
        return _normalized(profiles.normalize_content_rules, value)

    def validate_edition_rules(self, value):
        return _normalized(profiles.normalize_edition_rules, value)

    def validate_ranking(self, value):
        return _normalized(profiles.normalize_ranking, value)

    def validate_audio_language_order(self, value):
        return _normalized(
            profiles.normalize_language_order, value, "DUB language order"
        )

    def validate_subtitle_language_order(self, value):
        return _normalized(
            profiles.normalize_language_order, value, "SUB language order"
        )

    def validate_provider_order(self, value):
        return _normalized(profiles.normalize_provider_order, value)

    def validate_lists(self, value):
        ids = list(dict.fromkeys(value))
        if len(ids) != VODList.objects.filter(pk__in=ids).count():
            raise serializers.ValidationError("Select existing lists.")
        return ids

    def validate(self, attrs):
        current = self.instance

        def value(field):
            return attrs.get(field, getattr(current, field, None))

        if (
            current is not None
            and current.is_default
            and attrs.get("is_default", True) is False
        ):
            raise serializers.ValidationError(
                {"is_default": "Make another profile the default instead."}
            )
        if value("is_default") and value("is_active") is False:
            raise serializers.ValidationError(
                {"is_active": "The default profile is always active."}
            )
        if {"output_mode", "name_template"} & set(attrs):
            try:
                profiles.check_compact_name(
                    value("output_mode") or VODProfile.OutputMode.COMPACT,
                    value("name_template") or "",
                )
            except ValueError as error:
                raise serializers.ValidationError({"name_template": str(error)})
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        return self._save(VODProfile(), validated_data)

    @transaction.atomic
    def update(self, instance, validated_data):
        return self._save(instance, validated_data)

    def _save(self, profile, data):
        reactivated = profile.pk is None or not profile.is_active
        lists = data.pop("lists", None)
        if data.get("is_default"):
            VODProfile.objects.select_for_update().filter(is_default=True).exclude(
                pk=profile.pk
            ).update(is_default=False)
        for field, item in data.items():
            setattr(profile, field, item)
        profile.save()
        if lists is not None:
            profile.list_links.all().delete()
            VODProfileList.objects.bulk_create(
                VODProfileList(profile=profile, vod_list_id=pk, order=index)
                for index, pk in enumerate(lists)
            )
        profile_catalog.refresh_catalog(profile, force=reactivated)
        return profile


class VODProfileDraftSerializer(serializers.Serializer):
    profile = serializers.JSONField(
        help_text="Unsaved profile settings in the same shape as a profile."
    )

    def validate_profile(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Send the profile settings as an object.")
        settings = {
            key: item
            for key, item in value.items()
            if key not in {"id", "name", "users", "is_default", "is_active"}
        }
        serializer = VODProfileSerializer(data=settings, partial=True)
        serializer.is_valid(raise_exception=True)
        return serializer.validated_data


class VODProfileEditionCountsSerializer(serializers.Serializer):
    movie = serializers.DictField(child=serializers.IntegerField())
    series = serializers.DictField(child=serializers.IntegerField())


class VODProfilePreviewRequestSerializer(serializers.Serializer):
    content_type = serializers.ChoiceField(choices=["movie", "series"])
    search = serializers.CharField(required=False, allow_blank=True, max_length=255)
    excluded = serializers.BooleanField(
        required=False,
        default=False,
        help_text="List the titles the profile excludes instead of offered ones.",
    )
    account = serializers.IntegerField(
        required=False, allow_null=True, help_text="Titles with a source here."
    )
    category = serializers.IntegerField(
        required=False, allow_null=True, help_text="Titles with a source here."
    )
    edition = serializers.CharField(
        required=False,
        allow_null=True,
        allow_blank=True,
        max_length=120,
        help_text='Titles with an entry of this edition; "" for entries without one.',
    )
    page = serializers.IntegerField(required=False, min_value=1, default=1)
    page_size = serializers.IntegerField(
        required=False, min_value=1, max_value=100, default=50
    )


class VODProfilePreviewEntrySerializer(serializers.Serializer):
    name = serializers.CharField()
    source_id = serializers.IntegerField(help_text="Source the entry plays.")
    edition = serializers.CharField()
    provider = serializers.CharField()
    category = serializers.CharField()
    fallbacks = serializers.ListField(
        child=serializers.IntegerField(), help_text="Source IDs in failover order."
    )
    metadata = serializers.JSONField()
    sources = serializers.IntegerField()


class VODProfilePreviewSourceSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    provider = serializers.CharField()
    category = serializers.CharField()
    metadata = serializers.JSONField()
    entry = serializers.CharField(help_text="Client entry this source serves.")
    state = serializers.ChoiceField(
        choices=("selected", "fallback", "skipped", "unused"),
        help_text="Selected or fallback for an entry, skipped by the profile, "
        "or allowed but not needed.",
    )
    reason = serializers.CharField()


class VODProfilePreviewTitleSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    title = serializers.CharField()
    year = serializers.IntegerField(allow_null=True)
    reason = serializers.CharField()
    excluded = serializers.BooleanField(
        help_text="Whether the profile excludes this title itself."
    )
    entries = VODProfilePreviewEntrySerializer(many=True)
    sources = VODProfilePreviewSourceSerializer(many=True)


class VODProfilePreviewCategorySerializer(serializers.Serializer):
    value = serializers.IntegerField(help_text="Category ID for the filter.")
    label = serializers.CharField()


class VODProfilePreviewSerializer(serializers.Serializer):
    count = serializers.IntegerField()
    results = VODProfilePreviewTitleSerializer(many=True)
    categories = VODProfilePreviewCategorySerializer(
        many=True, help_text="Client categories the profile offers."
    )
    accounts = VODProfilePreviewCategorySerializer(
        many=True, help_text="Accounts the profile's entries come from."
    )
    editions = serializers.DictField(
        child=serializers.IntegerField(),
        help_text='Offered titles per edition, "" for entries without one.',
    )


class VODProfileOptionSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()


class VODProfileUserOptionSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField(source="username")


class VODProfileListOptionSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()
    list_type = serializers.CharField()
    content_type = serializers.CharField()
    is_enabled = serializers.BooleanField()


class VODProfileOptionsSerializer(serializers.Serializer):
    users = VODProfileUserOptionSerializer(many=True)
    accounts = VODProfileOptionSerializer(many=True)
    metadata_languages = serializers.ListField(
        child=serializers.CharField(),
        help_text="Library metadata languages a profile can prefer.",
    )
    lists = VODProfileListOptionSerializer(
        many=True, help_text="Lists a profile can offer with list output."
    )


class VODProfileValuesSerializer(serializers.Serializer):
    languages = serializers.ListField(child=serializers.JSONField())
    resolutions = serializers.ListField(child=serializers.CharField())
    video_features = serializers.ListField(child=serializers.CharField())
