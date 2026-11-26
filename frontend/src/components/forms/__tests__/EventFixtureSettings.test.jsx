import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import EventFixtureSettings from '../EventFixtureSettings';
import API from '../../../api';

vi.mock('../../../api', () => ({
  default: {
    getEventFixtureSettings: vi.fn(),
    saveEventFixtureSettings: vi.fn(),
  },
}));

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));

const SETTINGS = {
  openligadb_leagues: ['bl1', 'ucl'],
  thesportsdb_leagues: [],
  thesportsdb_key_set: false,
};

const renderSettings = () =>
  render(
    <MantineProvider>
      <EventFixtureSettings />
    </MantineProvider>
  );

describe('EventFixtureSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    API.getEventFixtureSettings.mockResolvedValue(SETTINGS);
  });

  it('saves leagues and sends the key only when one was typed', async () => {
    API.saveEventFixtureSettings.mockResolvedValue({
      ...SETTINGS,
      thesportsdb_key_set: true,
    });
    renderSettings();
    expect(await screen.findByText('bl1')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Save fixture sources' })
    );
    await waitFor(() =>
      expect(API.saveEventFixtureSettings).toHaveBeenLastCalledWith({
        openligadb_leagues: ['bl1', 'ucl'],
        thesportsdb_leagues: [],
      })
    );
    fireEvent.change(screen.getByLabelText(/TheSportsDB API key/), {
      target: { value: 'k3y' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Save fixture sources' })
    );
    await waitFor(() =>
      expect(API.saveEventFixtureSettings).toHaveBeenLastCalledWith(
        expect.objectContaining({ thesportsdb_key: 'k3y' })
      )
    );
    expect(await screen.findByPlaceholderText('Saved')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove key' }));
    await waitFor(() =>
      expect(API.saveEventFixtureSettings).toHaveBeenLastCalledWith({
        thesportsdb_key: '',
      })
    );
  });
});
