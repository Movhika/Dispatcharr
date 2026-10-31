import { useEffect, useState } from 'react';
import { Image } from '@mantine/core';

const RETRY_DELAY_MS = 1500;

// Artwork the server fetches and caches on its first request can fail while
// it does; one delayed retry usually succeeds. The fallback shows afterwards.
export default function RetryImage({ src, fallback = null, ...props }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setAttempt(0);
    setFailed(false);
  }, [src]);

  if (!src || failed) return fallback;
  const url = attempt
    ? `${src}${src.includes('?') ? '&' : '?'}retry=${attempt}`
    : src;
  return (
    <Image
      {...props}
      src={url}
      onError={() => {
        if (attempt) setFailed(true);
        else setTimeout(() => setAttempt(1), RETRY_DELAY_MS);
      }}
    />
  );
}
