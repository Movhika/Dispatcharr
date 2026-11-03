import re

from django.db import transaction
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from . import lists
from .library_serializers import MONTH_DAY, LibrarySelectionSerializer
from .models import VODList


class VODListItemSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    content_type = serializers.ChoiceField(choices=["movie", "series"])
    content_id = serializers.IntegerField(allow_null=True)
    title = serializers.CharField()
    year = serializers.IntegerField(allow_null=True)
    poster_url = serializers.CharField(allow_blank=True)
    tmdb_id = serializers.CharField(allow_blank=True)
    available = serializers.BooleanField(
        help_text="Whether the title is in the Library."
    )
    position = serializers.IntegerField()


class VODListSerializer(serializers.ModelSerializer):
    display_name = serializers.SerializerMethodField(
        help_text="The name clients see today, with {year} and {season} filled in."
    )
    visible = serializers.SerializerMethodField(
        help_text="Whether clients see the list today."
    )
    preview = serializers.SerializerMethodField(
        help_text="The first titles of the list in its order, for the overview."
    )

    class Meta:
        model = VODList
        fields = (
            "id",
            "name",
            "display_name",
            "list_type",
            "content_type",
            "filters",
            "tmdb_source",
            "tmdb_settings",
            "sort_mode",
            "is_enabled",
            "visible",
            "visible_from",
            "visible_until",
            "refresh_interval",
            "cron_expression",
            "preview",
            "build_status",
            "build_counts",
            "build_error",
            "built_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "build_status",
            "build_counts",
            "build_error",
            "built_at",
            "created_at",
            "updated_at",
        )
        extra_kwargs = {"refresh_interval": {"max_value": 8760}}

    @extend_schema_field(serializers.CharField())
    def get_display_name(self, vod_list):
        return lists.display_name(vod_list)

    @extend_schema_field(serializers.BooleanField())
    def get_visible(self, vod_list):
        return lists.is_visible(vod_list)

    @extend_schema_field(VODListItemSerializer(many=True))
    def get_preview(self, vod_list):
        items = lists.ordered_items(vod_list).select_related(
            "movie__logo", "series__logo"
        )
        return lists.item_documents(
            items[: lists.PREVIEW_ITEMS], self.context.get("request")
        )

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a list name.")
        duplicate = VODList.objects.filter(name__iexact=value)
        if self.instance is not None:
            duplicate = duplicate.exclude(pk=self.instance.pk)
        if duplicate.exists():
            raise serializers.ValidationError("A list with this name exists.")
        return value

    def validate_filters(self, value):
        from django.utils import timezone

        from .library_filters import date_conflict

        if not isinstance(value, dict):
            raise serializers.ValidationError("Send the filters as an object.")
        try:
            stored = lists.stored_filters(value)
            checked = lists.rules_filters(stored, "movie")
        except serializers.ValidationError as error:
            raise serializers.ValidationError(error.detail) from error
        if date_conflict(checked, timezone.localdate()):
            raise serializers.ValidationError(
                {
                    "released_since": "Released starts after the Added period ends, so no title can match."
                }
            )
        return stored

    def validate_cron_expression(self, value):
        value = value.strip()
        if value:
            from core.scheduling import parse_cron_expression

            try:
                parse_cron_expression(value)
            except ValueError as error:
                raise serializers.ValidationError(str(error)) from error
        return value

    def validate(self, attrs):
        current = self.instance

        def value(field, default=None):
            return attrs.get(field, getattr(current, field, default))

        list_type = value("list_type", VODList.ListType.MANUAL)
        # Only rules lists filter the Library; TMDB lists follow TMDB alone.
        if list_type != VODList.ListType.RULES:
            attrs["filters"] = {}
        if list_type != VODList.ListType.TMDB:
            attrs["tmdb_source"] = ""
            attrs["tmdb_settings"] = {}
        errors = {}
        start, end = value("visible_from", ""), value("visible_until", "")
        for field, day in (("visible_from", start), ("visible_until", end)):
            if day and not re.fullmatch(MONTH_DAY, day):
                errors[field] = "Enter the day as MM-DD."
        if bool(start) != bool(end) and not errors:
            errors["visible_until"] = "Enter both days of the visible period."
        if list_type == VODList.ListType.TMDB:
            errors.update(self._tmdb_errors(attrs, value))
        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    def _tmdb_errors(self, attrs, value):
        source = value("tmdb_source", "")
        settings = value("tmdb_settings", {}) or {}
        if source not in lists.TMDB_SOURCES:
            return {"tmdb_source": "Choose a TMDB source."}
        errors = {}
        if value("content_type", "all") not in lists.TMDB_SOURCES[source]:
            return {"tmdb_source": "This source does not offer this content."}
        if source in ("trending", "popular", "now-playing"):
            attrs["tmdb_settings"] = {}
        elif source == "list":
            list_id = str(settings.get("list_id") or "").strip()
            if not list_id.isdigit():
                errors["tmdb_settings"] = {"list_id": "Enter the numeric TMDB list ID."}
            attrs["tmdb_settings"] = {"list_id": list_id}
        else:
            validate = self._provider if source == "watch-provider" else self._discover
            problems, attrs["tmdb_settings"] = validate(settings)
            if problems:
                errors["tmdb_settings"] = problems
        return errors

    @staticmethod
    def _provider(settings):
        """Validated streaming service options and the problems found."""
        provider = str(settings.get("provider_id") or "").strip()
        region = str(settings.get("region") or "").strip().upper()
        monetization = settings.get("monetization") or "flatrate"
        problems = {}
        if not provider.isdigit():
            problems["provider_id"] = "Choose a streaming service."
        if not re.fullmatch(r"[A-Z]{2}", region):
            problems["region"] = "Choose a region."
        if monetization not in lists.MONETIZATION:
            problems["monetization"] = "Choose how titles are offered."
        return problems, {
            "provider_id": provider,
            "region": region,
            "monetization": monetization,
        }

    @staticmethod
    def _discover(settings):
        """Validated discover options and the problems found."""
        problems = {}
        clean = {}
        mode = settings.get("release_mode") or ""
        if mode not in ("", *lists.RELEASE_MODES):
            problems["release_mode"] = "Choose how releases are chosen."
        elif mode:
            clean["release_mode"] = mode
        if mode == "days":
            days = str(settings.get("release_days") or "")
            if not days.isdigit() or not 1 <= int(days) <= 36500:
                problems["release_days"] = "Enter the number of days."
            else:
                clean["release_days"] = int(days)
        if mode in ("week", "month", "season", "year") and settings.get("release_anchor"):
            anchor = str(settings["release_anchor"])
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", anchor):
                problems["release_anchor"] = "Choose the period."
            else:
                clean["release_anchor"] = anchor
        if mode == "yearly":
            for key in ("release_from_day", "release_until_day"):
                day = str(settings.get(key) or "")
                if not re.fullmatch(MONTH_DAY, day):
                    problems[key] = "Enter the day as MM-DD."
                else:
                    clean[key] = day
        if mode == "range":
            for key in ("release_since", "release_until"):
                day = str(settings.get(key) or "")
                if day and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
                    problems[key] = "Enter the date as YYYY-MM-DD."
                elif day:
                    clean[key] = day
            if not problems and not (clean.get("release_since") or clean.get("release_until")):
                problems["release_since"] = "Enter at least one date."
        genres = [str(genre) for genre in settings.get("genres") or []]
        if not all(genre.isdigit() for genre in genres):
            problems["genres"] = "Choose TMDB genres."
        elif genres:
            clean["genres"] = genres
        if settings.get("anime"):
            clean["anime"] = True
        keywords = settings.get("keywords") or []
        if not isinstance(keywords, list) or len(keywords) > 20 or not all(
            isinstance(keyword, dict)
            and str(keyword.get("id") or "").isdigit()
            and isinstance(keyword.get("name"), str)
            for keyword in keywords
        ):
            problems["keywords"] = "Choose TMDB keywords."
        elif keywords:
            clean["keywords"] = [
                {"id": str(keyword["id"]), "name": keyword["name"][:100]}
                for keyword in keywords
            ]
            if settings.get("keyword_match") == "all":
                clean["keyword_match"] = "all"
        language = str(settings.get("original_language") or "").strip().lower()
        if language and not re.fullmatch(r"[a-z]{2}", language):
            problems["original_language"] = "Choose an original language."
        elif language:
            clean["original_language"] = language
        return problems, clean

    @transaction.atomic
    def create(self, validated_data):
        vod_list = super().create(validated_data)
        lists.sync_schedule(vod_list)
        if vod_list.list_type == VODList.ListType.MANUAL:
            lists.build_list(vod_list)
        else:
            lists.request_list_build(vod_list)
        return vod_list

    @transaction.atomic
    def update(self, instance, validated_data):
        retyped = validated_data.get("list_type", instance.list_type) != instance.list_type
        rebuild = retyped or any(
            field in validated_data
            and validated_data[field] != getattr(instance, field)
            for field in ("content_type", "filters", "tmdb_source", "tmdb_settings")
        )
        vod_list = super().update(instance, validated_data)
        lists.sync_schedule(vod_list)
        if retyped:
            # A new type brings its own titles; hand-picked ones are gone.
            vod_list.items.all().delete()
            if vod_list.list_type == VODList.ListType.MANUAL:
                lists.build_list(vod_list)
        if rebuild and vod_list.list_type != VODList.ListType.MANUAL:
            lists.request_list_build(vod_list)
        else:
            # Visibility and content type change which profile entries exist.
            transaction.on_commit(lambda: lists.refresh_profiles(vod_list))
        return vod_list


class VODListItemsSerializer(serializers.Serializer):
    count = serializers.IntegerField()
    results = VODListItemSerializer(many=True)


class VODListItemsQuerySerializer(serializers.Serializer):
    search = serializers.CharField(required=False, allow_blank=True, max_length=255)
    content_type = serializers.ChoiceField(choices=["movie", "series"], required=False)
    available = serializers.ChoiceField(choices=["true", "false"], required=False)
    page = serializers.IntegerField(required=False, min_value=1, default=1)
    page_size = serializers.IntegerField(
        required=False, min_value=1, max_value=200, default=50
    )


class VODListAddItemsSerializer(LibrarySelectionSerializer):
    sources = serializers.BooleanField(
        default=False,
        help_text="The selection holds sources from the Sources view; their titles are added.",
    )


class VODListItemIdsSerializer(serializers.Serializer):
    ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1), max_length=lists.MAX_ITEMS
    )


class VODListOptionSerializer(serializers.Serializer):
    value = serializers.CharField()
    label = serializers.CharField()


class VODListTmdbOptionsSerializer(serializers.Serializer):
    regions = VODListOptionSerializer(many=True)
    providers = VODListOptionSerializer(many=True)
    genres = VODListOptionSerializer(many=True)
    languages = VODListOptionSerializer(many=True)


class VODListTmdbOptionsQuerySerializer(serializers.Serializer):
    content_type = serializers.ChoiceField(choices=["movie", "series"])
    region = serializers.RegexField(r"^[A-Za-z]{2}$", required=False)


class VODListTmdbKeywordQuerySerializer(serializers.Serializer):
    query = serializers.CharField(min_length=2, max_length=100)
