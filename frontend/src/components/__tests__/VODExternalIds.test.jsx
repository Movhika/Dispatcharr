import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({
  default: { updateVODTmdbMatch: vi.fn() },
}));
vi.mock('../../store/auth', () => ({ default: vi.fn() }));
vi.mock('../../utils/notificationUtils', () => ({
  showNotification: vi.fn(),
}));
vi.mock('lucide-react', () => ({
  Pencil: () => null,
  Save: () => null,
  X: () => null,
}));
vi.mock('@mantine/core', () => ({
  Badge: ({ children, component, href }) =>
    component === 'a' ? <a href={href}>{children}</a> : <span>{children}</span>,
  Button: ({ children, onClick, disabled, loading }) => (
    <button onClick={onClick} disabled={disabled || loading}>
      {children}
    </button>
  ),
  Group: ({ children }) => <div>{children}</div>,
  Text: ({ children }) => <span>{children}</span>,
  TextInput: ({ value, onChange, 'aria-label': ariaLabel }) => (
    <input aria-label={ariaLabel} value={value} onChange={onChange} />
  ),
}));

import API from '../../api';
import useAuthStore from '../../store/auth';
import VODExternalIds from '../VODExternalIds.jsx';

describe('VODExternalIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.mockImplementation((selector) =>
      selector({ user: { user_level: 10 } })
    );
    API.updateVODTmdbMatch.mockResolvedValue({
      tmdb: { id: '76600', override_id: '76600', external_ids: {} },
      refresh: { queued: true, status: 'queued' },
    });
  });

  it('shows concrete external IDs and saves a separate TMDB override', async () => {
    const onSaved = vi.fn();
    render(
      <VODExternalIds
        contentType="movie"
        contentId={7}
        tmdb={{
          id: '123',
          override_id: '',
          external_ids: { imdb_id: 'tt123', tvdb_id: '456' },
        }}
        onSaved={onSaved}
      />
    );

    expect(screen.getByRole('link', { name: 'TMDB 123' })).toHaveAttribute(
      'href',
      'https://www.themoviedb.org/movie/123'
    );
    expect(screen.getByText('TVDB 456')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Correct TMDB match' }));
    fireEvent.change(screen.getByLabelText('TMDB ID'), {
      target: { value: '76600' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(API.updateVODTmdbMatch).toHaveBeenCalledWith('movie', 7, '76600')
    );
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ id: '76600' })
    );
  });
});
