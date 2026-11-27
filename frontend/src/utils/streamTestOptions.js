// What happens with the stream order of a channel after a stream test.
export const STREAM_TEST_SORTS = [
  {
    value: 'none',
    label: 'Keep the order',
    description: 'Only record which streams work and their quality.',
  },
  {
    value: 'quality',
    label: 'Best quality first',
    description: 'Highest resolution, then frame rate and bitrate.',
  },
  {
    value: 'startup',
    label: 'Fastest start first',
    description: 'Streams that answered quickest come first.',
  },
];
