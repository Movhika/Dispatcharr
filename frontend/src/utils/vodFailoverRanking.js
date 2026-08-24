const DEFAULT_VOD_FAILOVER_RANKING = [
  'audio_language',
  'subtitle_language',
  'resolution_desc',
  'bitrate_desc',
  'metadata_completeness',
];

const normalizeVODFailoverRanking = (ranking = []) => {
  const normalized = ranking.map((key) =>
    key === 'resolution' ? 'resolution_desc' : key
  );
  const resolutionDirection = normalized.find(
    (key) => key === 'resolution_desc' || key === 'resolution_asc'
  );
  const bitrateDirection = normalized.find(
    (key) => key === 'bitrate_desc' || key === 'bitrate_asc'
  );
  const supported = new Set([
    ...DEFAULT_VOD_FAILOVER_RANKING,
    'resolution_asc',
    'bitrate_asc',
  ]);
  const defaults = DEFAULT_VOD_FAILOVER_RANKING.map((key) =>
    key === 'resolution_desc' && resolutionDirection
      ? resolutionDirection
      : key === 'bitrate_desc' && bitrateDirection
        ? bitrateDirection
        : key
  );

  return [...new Set([...normalized, ...defaults])].filter(
    (key) =>
      supported.has(key) &&
      (key !== 'resolution_desc' || resolutionDirection !== 'resolution_asc') &&
      (key !== 'resolution_asc' || resolutionDirection === 'resolution_asc') &&
      (key !== 'bitrate_desc' || bitrateDirection !== 'bitrate_asc') &&
      (key !== 'bitrate_asc' || bitrateDirection === 'bitrate_asc')
  );
};

export { DEFAULT_VOD_FAILOVER_RANKING, normalizeVODFailoverRanking };
