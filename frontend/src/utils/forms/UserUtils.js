import { NETWORK_ACCESS_OPTIONS, USER_LEVELS } from '../../constants.js';
import { IPV4_CIDR_REGEX, IPV6_CIDR_REGEX } from '../networkUtils.js';
import API from '../../api.js';

const isValidNetworkEntry = (entry) =>
  entry.match(IPV4_CIDR_REGEX) ||
  entry.match(IPV6_CIDR_REGEX) ||
  (entry + '/32').match(IPV4_CIDR_REGEX) ||
  (entry + '/128').match(IPV6_CIDR_REGEX);
const NETWORK_KEYS = Object.keys(NETWORK_ACCESS_OPTIONS);

export const createUser = (values) => {
  return API.createUser(values);
};

export const updateUser = (userId, values, isAdmin, authUser) => {
  return API.updateUser(
    userId,
    values,
    isAdmin ? false : authUser.id === userId
  );
};

export const generateApiKey = (payload) => {
  return API.generateApiKey(payload);
};

export const revokeApiKey = (payload) => {
  return API.revokeApiKey(payload);
};

export const userToFormValues = (user) => {
  const customProps = user.custom_properties || {};
  const networks = customProps.allowed_networks || {};
  const vodPolicy = user.vod_policy || {};
  const vodConstraints = vodPolicy.hard_constraints || {};

  return {
    username: user.username,
    first_name: user.first_name || '',
    last_name: user.last_name || '',
    email: user.email,
    user_level: `${user.user_level}`,
    stream_limit: user.stream_limit || 0,
    channel_profiles:
      user.channel_profiles.length > 0
        ? user.channel_profiles.map((id) => `${id}`)
        : ['0'],
    xc_password: customProps.xc_password || '',
    output_format: customProps.output_format || '',
    output_profile: customProps.output_profile
      ? `${customProps.output_profile}`
      : '',
    hide_adult_content: customProps.hide_adult_content || false,
    catchup_enabled: customProps.catchup_enabled !== false,
    epg_days: customProps.epg_days || 0,
    epg_prev_days: customProps.epg_prev_days || 0,
    allowed_ips: [
      ...new Set(
        NETWORK_KEYS.flatMap((key) =>
          networks[key] ? networks[key].split(',').filter(Boolean) : []
        )
      ),
    ],
    vod_export_mode: vodPolicy.export_mode || 'compact',
    vod_audio_languages: vodConstraints.required_audio_languages || [],
    vod_subtitle_languages: vodConstraints.required_subtitle_languages || [],
    vod_preferred_resolutions: vodConstraints.preferred_resolutions || [],
    vod_min_height: vodConstraints.min_height || 0,
    vod_max_height: vodConstraints.max_height || 0,
    vod_allow_unknown: vodConstraints.allow_unknown_metadata !== false,
  };
};

export const formValuesToPayload = (values, existingUser) => {
  const customProps = { ...(existingUser?.custom_properties || {}) };
  const payload = { ...values };

  customProps.xc_password = payload.xc_password || '';
  delete payload.xc_password;

  customProps.output_format = payload.output_format || null;
  delete payload.output_format;

  customProps.output_profile = payload.output_profile
    ? parseInt(payload.output_profile, 10)
    : null;
  delete payload.output_profile;

  customProps.hide_adult_content = payload.hide_adult_content || false;
  delete payload.hide_adult_content;

  customProps.catchup_enabled = payload.catchup_enabled !== false;
  delete payload.catchup_enabled;

  customProps.epg_days = payload.epg_days || 0;
  delete payload.epg_days;

  customProps.epg_prev_days = payload.epg_prev_days || 0;
  delete payload.epg_prev_days;

  const joined = (payload.allowed_ips || []).join(',');
  delete payload.allowed_ips;
  const allowed_networks = {};
  if (joined) {
    NETWORK_KEYS.forEach((key) => {
      allowed_networks[key] = joined;
    });
  }
  customProps.allowed_networks = allowed_networks;

  payload.vod_policy_settings = {
    export_mode: payload.vod_export_mode || 'compact',
    hard_constraints: {
      required_audio_languages: payload.vod_audio_languages || [],
      required_subtitle_languages: payload.vod_subtitle_languages || [],
      preferred_resolutions: payload.vod_preferred_resolutions || [],
      min_height: payload.vod_min_height || 0,
      max_height: payload.vod_max_height || 0,
      allow_unknown_metadata: payload.vod_allow_unknown !== false,
    },
    ranking: ['audio_language', 'subtitle_language', 'resolution'],
  };
  [
    'vod_export_mode',
    'vod_audio_languages',
    'vod_subtitle_languages',
    'vod_preferred_resolutions',
    'vod_min_height',
    'vod_max_height',
    'vod_allow_unknown',
  ].forEach((key) => delete payload[key]);

  payload.custom_properties = customProps;

  if (payload.channel_profiles?.includes('0')) {
    payload.channel_profiles = [];
  }

  return payload;
};

export const getFormInitialValues = () => {
  return {
    username: '',
    first_name: '',
    last_name: '',
    email: '',
    user_level: '0',
    stream_limit: 0,
    password: '',
    xc_password: '',
    output_format: '',
    output_profile: '',
    channel_profiles: [],
    hide_adult_content: false,
    catchup_enabled: true,
    epg_days: 0,
    epg_prev_days: 0,
    allowed_ips: [],
    vod_export_mode: 'compact',
    vod_audio_languages: [],
    vod_subtitle_languages: [],
    vod_preferred_resolutions: [],
    vod_min_height: 0,
    vod_max_height: 0,
    vod_allow_unknown: true,
  };
};

export const getFormValidators = (user) => {
  return (values) => ({
    username: !values.username
      ? 'Username is required'
      : !values.username.match(/^[A-Za-z0-9._@-]+$/)
        ? 'Username may only contain letters, numbers, periods (.), underscores (_), at signs (@), and hyphens (-)'
        : null,
    password:
      !user && !values.password && values.user_level != USER_LEVELS.STREAMER
        ? 'Password is required'
        : null,
    xc_password:
      values.xc_password && !values.xc_password.match(/^[A-Za-z0-9._@-]+$/)
        ? 'XC password may only contain letters, numbers, periods (.), underscores (_), at signs (@), and hyphens (-)'
        : null,
    allowed_ips: (values.allowed_ips || []).some((t) => !isValidNetworkEntry(t))
      ? 'Invalid IP address or CIDR range'
      : null,
  });
};
