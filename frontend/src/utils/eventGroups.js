// Values of a new event group.
export const NEW_GROUP = {
  name: '',
  enabled: true,
  channel_group: null,
  sources: [],
  start_number: 1,
  end_number: null,
  lookahead_hours: 24,
  include_untimed: false,
  name_format: 'title_time',
  channel_profile_ids: [],
};

// Badge colors of event states.
export const STATUS_COLORS = {
  live: 'red',
  upcoming: 'blue',
  unknown: 'gray',
  ended: 'gray',
};
