import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import RetryImage from '../RetryImage.jsx';

const renderImage = () =>
  render(
    <MantineProvider>
      <RetryImage src="/poster?v=1" alt="Poster" fallback={<span>none</span>} />
    </MantineProvider>
  );

describe('RetryImage', () => {
  it('retries a failed image once before showing the fallback', () => {
    vi.useFakeTimers();
    renderImage();
    fireEvent.error(screen.getByAltText('Poster'));
    act(() => vi.advanceTimersByTime(1500));
    expect(screen.getByAltText('Poster').getAttribute('src')).toBe(
      '/poster?v=1&retry=1'
    );
    fireEvent.error(screen.getByAltText('Poster'));
    expect(screen.getByText('none')).toBeTruthy();
    vi.useRealTimers();
  });
});
