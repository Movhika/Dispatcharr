export const RESOLUTION_VALUES = [
  '360p',
  '480p',
  '576p',
  '720p',
  '1080p',
  '1440p',
  '2160p',
  '4320p',
];

export const RESOLUTION_LIMIT_OPTIONS = [
  { value: '0', label: 'No limit' },
  ...RESOLUTION_VALUES.map((label) => ({
    value: label.replace('p', ''),
    label,
  })),
];

export const CONTAINER_EXTENSION_OPTIONS = [
  'mkv',
  'mp4',
  'avi',
  'mov',
  'ts',
  'm3u8',
];

export const VIDEO_FEATURE_OPTIONS = [
  { value: '3d', label: 'Any 3D / layout unknown' },
  { value: '3d_sbs', label: '3D SBS' },
  { value: '3d_tab', label: '3D TAB / OU' },
  { value: 'hdr', label: 'Any HDR / type unknown' },
  { value: 'hdr10', label: 'HDR10' },
  { value: 'hdr10_plus', label: 'HDR10+' },
  { value: 'dolby_vision', label: 'Dolby Vision' },
  { value: 'hlg', label: 'HLG' },
];

export const videoFeatureLabel = (value) =>
  VIDEO_FEATURE_OPTIONS.find((option) => option.value === value)?.label ||
  value;

export const VOD_METADATA_FIELDS = [
  'audio_languages',
  'subtitle_languages',
  'resolution',
  'container_extension',
  'video_features',
];
