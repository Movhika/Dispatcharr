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
