"""Source-asset identity and field-level metadata precedence helpers."""

import re
from collections import defaultdict
from urllib.parse import urlsplit

from django.db import transaction

from .models import (
    M3UEpisodeRelation,
    M3UMovieRelation,
    M3USeriesRelation,
    M3UVODCategoryRelation,
    VODSourceAsset,
)


RELATION_CONFIG = {
    M3UMovieRelation: (VODSourceAsset.AssetType.MOVIE, "stream_id"),
    M3USeriesRelation: (VODSourceAsset.AssetType.SERIES, "external_series_id"),
    M3UEpisodeRelation: (VODSourceAsset.AssetType.EPISODE, "stream_id"),
}


LANGUAGE_ALIASES = {
    "de": "ger",
    "deu": "ger",
    "ger": "ger",
    "german": "ger",
    "deutsch": "ger",
    "en": "eng",
    "eng": "eng",
    "english": "eng",
    "englisch": "eng",
    "fr": "fre",
    "fra": "fre",
    "fre": "fre",
    "french": "fre",
    "français": "fre",
    "es": "spa",
    "spa": "spa",
    "spanish": "spa",
    "español": "spa",
    "it": "ita",
    "ita": "ita",
    "italian": "ita",
    "nl": "dut",
    "nld": "dut",
    "dut": "dut",
    "dutch": "dut",
}

# Dispatcharr exposes the bibliographic ISO-639-2 codes used by common IPTV
# clients (for example ``ger`` rather than the terminology code ``deu``).
# Keeping the allow-list here makes every write path validate the same values
# instead of letting arbitrary free text leak into policy matching.
ISO_639_2B_CODES = frozenset(
    """
    aar abk ace ach ada ady afa afh afr ain aka akk alb ale alg alt amh ang anp
    apa ara arc arg arm arn arp art arw asm ast ath aus ava ave awa aym aze bad
    bai bak bal bam ban baq bas bat bej bel bem ben ber bho bih bik bin bis bla
    bnt bod bos bra bre btk bua bug bul bur byn cad cai car cat cau ceb cel cha
    chb che chg chi chk chm chn cho chp chr chu chv chy cmc cnr cop cor cos cpe
    cpf cpp cre crh crp csb cus cze dak dan dar day del den dgr din div doi dra
    dsb dua dum dut dyu dzo efi egy eka elx eng enm epo est ewe ewo fan fao fat
    fij fil fin fiu fon fre frm fro frr frs fry ful fur gaa gay gba gem geo ger
    gez gil gla gle glg glv gmh goh gon gor got grb grc gre grn gsw guj gwi hai
    hat hau haw heb her hil him hin hit hmn hmo hrv hsb hun hup iba ibo ice ido
    iii ijo iku ile ilo ina inc ind ine inh ipk ira iro ita jav jbo jpn jpr jrb
    kaa kab kac kal kam kan kar kas kau kaw kaz kbd kha khi khm kho kik kin kir
    kmb kok kom kon kor kos kpe krc krl kro kru kua kum kur kut lad lah lam lao
    lat lav lez lim lin lit lol loz ltz lua lub lug lui lun luo lus mac mad mag
    mah mai mak mal man mao map mar mas may mdf mdr men mga mic min mis mkh mlg
    mlt mnc mni mno moh mon mos mul mun mus mwl mwr myn myv nah nai nap nau nav
    nbl nde ndo nds nep new nia nic niu nno nob nog non nor nqo nso nub nwc nya
    nym nyn nyo nzi oci oji ori orm osa oss ota oto paa pag pal pam pan pap pau
    peo per phi phn pli pol pon por pra pro pus que raj rap rar roa roh rom rum
    run rup rus sad sag sah sai sal sam san sas sat scn sco sel sem sga sgn shn
    sid sin sio sit sla slo slv sma sme smi smj smn smo sms sna snd snk sog som
    son sot spa srd srn srp srr ssa ssw suk sun sus sux swa swe syc syr tah tai
    tam tat tel tem ter tet tgk tgl tha tib tig tir tiv tkl tlh tli tmh tog ton
    tpi tsi tsn tso tuk tum tup tur tut tvl twi tyv udm uga uig ukr umb und urd
    uzb vai ven vie vol vot wak wal war was wel wen wln wol xal yao yap yid yor
    ypk zap zbl zen zgh zha znd zul zun zxx
    """.split()
)


VIDEO_FEATURE_ALIASES = {
    "3d": "3d",
    "sbs": "3d_sbs",
    "hsbs": "3d_sbs",
    "side-by-side": "3d_sbs",
    "side by side": "3d_sbs",
    "3d_sbs": "3d_sbs",
    "tab": "3d_tab",
    "hou": "3d_tab",
    "over-under": "3d_tab",
    "top-and-bottom": "3d_tab",
    "top and bottom": "3d_tab",
    "3d_tab": "3d_tab",
    "hdr": "hdr",
    "hdr10": "hdr10",
    "hdr10+": "hdr10_plus",
    "hdr10_plus": "hdr10_plus",
    "dv": "dolby_vision",
    "dovi": "dolby_vision",
    "dolby vision": "dolby_vision",
    "dolby_vision": "dolby_vision",
    "hlg": "hlg",
}

VIDEO_FEATURES = frozenset(VIDEO_FEATURE_ALIASES.values())


def normalize_language_code(value):
    """Return Dispatcharr's English ISO-639-2/B language code."""
    code = str(value or "").strip().lower()
    return LANGUAGE_ALIASES.get(code, code)


def normalize_language_list(value):
    if isinstance(value, str):
        value = [part.strip() for part in value.replace(";", ",").split(",")]
    if not isinstance(value, (list, tuple, set)):
        return []
    return list(
        dict.fromkeys(
            normalized
            for normalized in (normalize_language_code(item) for item in value)
            if normalized
        )
    )


def invalid_language_codes(value):
    """Return normalized values which are not ISO-639-2/B codes."""
    return [
        code
        for code in normalize_language_list(value)
        if code not in ISO_639_2B_CODES
    ]


def normalize_video_features(value):
    """Return stable technical feature identifiers for policy matching."""
    if isinstance(value, str):
        value = [part.strip() for part in value.replace(";", ",").split(",")]
    if not isinstance(value, (list, tuple, set)):
        return []
    return list(
        dict.fromkeys(
            normalized
            for normalized in (
                VIDEO_FEATURE_ALIASES.get(str(item or "").strip().lower())
                for item in value
            )
            if normalized
        )
    )


def compatible_video_features(value):
    """Return concrete stored values matched by one UI/profile feature."""
    normalized = normalize_video_features([value])
    if not normalized:
        return []
    feature = normalized[0]
    if feature == "3d":
        return ["3d", "3d_sbs", "3d_tab"]
    if feature == "hdr":
        return ["hdr", "hdr10", "hdr10_plus", "dolby_vision", "hlg"]
    return [feature]


def detect_video_features(*values):
    """Infer conservative 3D/HDR flags from provider names and video details."""
    text = " ".join(str(value or "") for value in values).lower()
    detected = []
    if re.search(r"(?:^|[\s._|\-])(?:h?sbs|side[\s._-]*by[\s._-]*side)(?:$|[\s._|\-])", text):
        detected.append("3d_sbs")
    elif re.search(r"(?:^|[\s._|\-])(?:h?ou|tab|top[\s._-]*and[\s._-]*bottom|over[\s._-]*under)(?:$|[\s._|\-])", text):
        detected.append("3d_tab")
    elif re.search(r"(?:^|[\s._|\-])3d(?:$|[\s._|\-])", text):
        detected.append("3d")

    if re.search(r"\b(?:dolby[\s._-]*vision|dovi|dvhe|dvh1)\b", text):
        detected.append("dolby_vision")
    elif re.search(r"\bhdr10(?:\+(?!\w)|[\s._-]*plus\b)", text):
        detected.append("hdr10_plus")
    elif re.search(r"\bhdr10\b", text):
        detected.append("hdr10")
    elif re.search(r"\b(?:hdr|smpte2084|smpte2086|pq)\b", text):
        detected.append("hdr")
    if re.search(r"\b(?:hlg|arib[\s._-]*std[\s._-]*b67)\b", text):
        detected.append("hlg")
    return list(dict.fromkeys(detected))


def validate_source_metadata(metadata):
    """Normalize source metadata and reject invalid language identifiers."""
    normalized = normalize_source_metadata(metadata)
    invalid = {}
    for field in ("audio_languages", "subtitle_languages", "languages"):
        bad = invalid_language_codes(normalized.get(field, []))
        if bad:
            invalid[field] = bad
    if invalid:
        details = "; ".join(
            f"{field}: {', '.join(values)}" for field, values in invalid.items()
        )
        raise ValueError(f"Use ISO-639-2/B language codes ({details})")
    return normalized


def normalize_source_metadata(metadata):
    """Normalize metadata at every API/provider/telemetry boundary."""
    normalized = dict(metadata or {})
    for field in ("audio_languages", "subtitle_languages", "languages"):
        if field in normalized:
            normalized[field] = normalize_language_list(normalized[field])
    if "video_features" in normalized:
        normalized["video_features"] = normalize_video_features(
            normalized["video_features"]
        )
    bitrate = normalize_bitrate_kbps(
        normalized.get("bitrate_kbps", normalized.get("bitrate"))
    )
    if bitrate:
        normalized["bitrate_kbps"] = bitrate
    file_size = normalize_file_size_bytes(
        normalized.get("file_size_bytes", normalized.get("file_size"))
    )
    if file_size:
        normalized["file_size_bytes"] = file_size
    return normalized


def _positive_number(value):
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if value > 0 else None
    match = re.search(r"\d+(?:[.,]\d+)?", str(value))
    if not match:
        return None
    number = float(match.group(0).replace(",", "."))
    return number if number > 0 else None


def normalize_bitrate_kbps(value, *, bits_per_second=False):
    """Return a positive bitrate in kbps from common XC/ffprobe shapes."""
    number = _positive_number(value)
    if number is None:
        return None
    text = str(value or "").lower()
    if "mbit" in text or "mbps" in text:
        number *= 1000
    elif bits_per_second or (
        ("bit" in text or "bps" in text)
        and "kbit" not in text
        and "kbps" not in text
    ):
        number /= 1000
    return round(number, 2)


def normalize_file_size_bytes(value):
    """Return a positive byte count when a provider exposes file size."""
    number = _positive_number(value)
    if number is None:
        return None
    text = str(value or "").strip().lower()
    unit_match = re.search(r"(?:^|\d)\s*(kib|mib|gib|tib|kb|mb|gb|tb|b)\s*$", text)
    unit = unit_match.group(1) if unit_match else "b"
    multipliers = {
        "b": 1,
        "kb": 1000,
        "mb": 1000 ** 2,
        "gb": 1000 ** 3,
        "tb": 1000 ** 4,
        "kib": 1024,
        "mib": 1024 ** 2,
        "gib": 1024 ** 3,
        "tib": 1024 ** 4,
    }
    return int(number * multipliers[unit])


def provider_origin_key(account):
    """Stable hint only; it never causes automatic cross-account merging."""
    if account.server_group_id:
        return f"server-group:{account.server_group_id}"
    parsed = urlsplit(account.server_url or "")
    host = (parsed.hostname or "").lower()
    port = parsed.port
    return f"host:{host}:{port or ''}" if host else f"account:{account.id}"


@transaction.atomic
def ensure_source_asset(relation):
    relation = (
        relation.__class__.objects.select_for_update(of=("self",))
        .select_related("m3u_account__server_group")
        .get(pk=relation.pk)
    )
    if relation.source_asset_id:
        return relation.source_asset

    asset_type, id_field = RELATION_CONFIG[type(relation)]
    asset = VODSourceAsset.objects.create(
        asset_type=asset_type,
        provider_origin_key=provider_origin_key(relation.m3u_account),
        provider_asset_id=str(getattr(relation, id_field) or ""),
        declared_metadata=relation_declared_metadata(relation),
    )
    relation.source_asset = asset
    relation.save(update_fields=["source_asset"])
    return asset


@transaction.atomic
def ensure_source_assets(relations):
    """Create missing source assets in batches and return every asset ID.

    This is used by mass editing. A series can contain thousands of episode
    relations, so calling ensure_source_asset once per row would otherwise
    produce an avoidable query-per-episode write path.
    """
    ids_by_model = defaultdict(set)
    for relation in relations:
        ids_by_model[type(relation)].add(relation.pk)

    asset_ids = set()
    for model, relation_ids in ids_by_model.items():
        locked = list(
            # ``server_group`` is optional, so select_related() adds a LEFT
            # OUTER JOIN. PostgreSQL cannot lock the nullable side of that
            # join. We only mutate relation rows here and therefore lock the
            # base table explicitly.
            model.objects.select_for_update(of=("self",))
            .select_related("m3u_account__server_group")
            .filter(pk__in=relation_ids)
            .order_by("pk")
        )
        missing = [relation for relation in locked if not relation.source_asset_id]
        assets = []
        for relation in missing:
            asset_type, id_field = RELATION_CONFIG[model]
            assets.append(
                VODSourceAsset(
                    asset_type=asset_type,
                    provider_origin_key=provider_origin_key(relation.m3u_account),
                    provider_asset_id=str(getattr(relation, id_field) or ""),
                    declared_metadata=relation_declared_metadata(relation),
                )
            )
        if assets:
            VODSourceAsset.objects.bulk_create(assets, batch_size=1000)
            for relation, asset in zip(missing, assets):
                relation.source_asset = asset
            model.objects.bulk_update(missing, ["source_asset"], batch_size=1000)

        asset_ids.update(
            relation.source_asset_id
            for relation in locked
            if relation.source_asset_id
        )
    return asset_ids


def category_defaults_for_relation(relation):
    category_id = getattr(relation, "category_id", None)
    if category_id is None:
        series_relation = getattr(relation, "series_relation", None)
        category_id = getattr(series_relation, "category_id", None)
    if not category_id:
        return {}
    category_relation = M3UVODCategoryRelation.objects.filter(
        m3u_account=relation.m3u_account,
        category_id=category_id,
    ).only("metadata_defaults").first()
    return category_relation.metadata_defaults if category_relation else {}


def relation_declared_metadata(relation):
    props = relation.custom_properties or {}
    detailed = props.get("detailed_info") or {}
    if not isinstance(detailed, dict):
        detailed = {}
    result = {}
    for key in ("video", "audio", "bitrate", "container_extension"):
        value = detailed.get(key)
        if value not in (None, "", [], {}):
            result[key] = value
    # Movie/episode container extensions are already stored on the relation by
    # the fast catalog import.  They do not require an advanced provider fetch
    # and should therefore be visible in the effective source metadata.
    container_extension = getattr(relation, "container_extension", None)
    if not container_extension:
        for payload_name in ("movie_data", "basic_data"):
            payload = props.get(payload_name) or {}
            if isinstance(payload, dict) and payload.get("container_extension"):
                container_extension = payload["container_extension"]
                break
    if container_extension:
        result["container_extension"] = str(container_extension).lower()
    video = result.get("video")
    if isinstance(video, dict):
        width = video.get("width")
        height = video.get("height")
        if height:
            result["height"] = height
            # Resolution policies use vertical pixels (720p/1080p/2160p).
            # Preserve width separately instead of making the policy compare
            # incomparable strings such as 1920x1080 and 1080p.
            result["resolution"] = f"{height}p"
            if width:
                result["width"] = width
        codec = video.get("codec_name") or video.get("codec_long_name")
        if codec:
            result["video_codec"] = codec
        frame_rate = video.get("avg_frame_rate") or video.get("r_frame_rate")
        if frame_rate and str(frame_rate) != "0/0":
            result["frame_rate"] = frame_rate
        if not result.get("bitrate") and video.get("bit_rate"):
            result["bitrate_kbps"] = normalize_bitrate_kbps(
                video["bit_rate"], bits_per_second=True
            )
    audio = result.get("audio")
    if isinstance(audio, dict):
        tags = audio.get("tags") if isinstance(audio.get("tags"), dict) else {}
        language = audio.get("language") or audio.get("lang") or tags.get("language")
        if language:
            result["audio_languages"] = [language]
        codec = audio.get("codec_name") or audio.get("codec_long_name")
        if codec:
            result["audio_codec"] = codec
    subtitles = detailed.get("subtitles") or detailed.get("subtitle")
    if isinstance(subtitles, dict):
        subtitles = [subtitles]
    if isinstance(subtitles, list):
        languages = []
        for subtitle in subtitles:
            if not isinstance(subtitle, dict):
                continue
            tags = subtitle.get("tags") if isinstance(subtitle.get("tags"), dict) else {}
            language = (
                subtitle.get("language")
                or subtitle.get("lang")
                or tags.get("language")
            )
            if language:
                languages.append(language)
        if languages:
            result["subtitle_languages"] = languages
    bitrate = normalize_bitrate_kbps(result.get("bitrate"))
    if bitrate:
        result["bitrate_kbps"] = bitrate
    for payload in (
        detailed,
        props.get("movie_data") or {},
        props.get("basic_data") or {},
    ):
        if not isinstance(payload, dict):
            continue
        raw_size = next(
            (
                payload.get(key)
                for key in ("file_size_bytes", "file_size", "filesize", "size")
                if payload.get(key) not in (None, "")
            ),
            None,
        )
        file_size = normalize_file_size_bytes(raw_size)
        if file_size:
            result["file_size_bytes"] = file_size
            break
    feature_inputs = [
        result.get("video"),
        detailed,
        props.get("movie_data"),
        props.get("basic_data"),
    ]
    for payload in (props.get("movie_data") or {}, props.get("basic_data") or {}):
        if isinstance(payload, dict):
            feature_inputs.extend(
                payload.get(key) for key in ("name", "title", "stream_display_name")
            )
    detected_features = detect_video_features(*feature_inputs)
    if detected_features:
        result["video_features"] = detected_features
    return normalize_source_metadata(result)


def sync_relation_declared_metadata(relation):
    """Persist provider/relation metadata on the lazy source-asset index."""
    asset = ensure_source_asset(relation)
    declared = relation_declared_metadata(relation)
    merged = {**(asset.declared_metadata or {}), **declared}
    if merged != (asset.declared_metadata or {}):
        asset.declared_metadata = merged
        asset.save(update_fields=["declared_metadata", "updated_at"])
    return asset


def effective_relation_metadata(relation):
    asset = relation.source_asset or ensure_source_asset(relation)
    return asset.effective_metadata(
        category_defaults=category_defaults_for_relation(relation),
        relation_declared=relation_declared_metadata(relation),
    )


def summarize_relation_metadata(relations, category_mapping=None):
    """Return a compact union of metadata across enabled source relations.

    Callers should load ``source_asset`` with ``select_related``/``Prefetch``.
    The category mapping is cached globally, so this helper never performs a
    query per VOD row.
    """
    if category_mapping is None:
        from .policies import enabled_category_map

        category_mapping = enabled_category_map()

    audio_languages = set()
    subtitle_languages = set()
    resolutions = set()
    containers = set()
    video_features = set()
    source_count = 0
    for relation in relations:
        category_id = getattr(relation, "category_id", None)
        if category_id is None:
            series_relation = getattr(relation, "series_relation", None)
            category_id = getattr(series_relation, "category_id", None)
        defaults = category_mapping.get(
            (relation.m3u_account_id, category_id)
        )
        if defaults is None:
            continue
        declared = relation_declared_metadata(relation)
        if relation.source_asset_id:
            metadata = relation.source_asset.effective_metadata(
                category_defaults=defaults,
                relation_declared=declared,
            )["values"]
        else:
            metadata = normalize_source_metadata({**defaults, **declared})
        audio_languages.update(
            normalize_language_list(
                metadata.get("audio_languages") or metadata.get("languages")
            )
        )
        subtitle_languages.update(
            normalize_language_list(metadata.get("subtitle_languages"))
        )
        resolution = metadata.get("resolution") or metadata.get("height")
        if resolution not in (None, "", [], {}):
            resolutions.add(str(resolution))
        container = metadata.get("container_extension")
        if container:
            containers.add(str(container).lower())
        video_features.update(normalize_video_features(metadata.get("video_features")))
        source_count += 1

    return {
        "audio_languages": sorted(audio_languages),
        "subtitle_languages": sorted(subtitle_languages),
        "resolutions": sorted(resolutions),
        "container_extensions": sorted(containers),
        "video_features": sorted(video_features),
        "source_count": source_count,
    }
