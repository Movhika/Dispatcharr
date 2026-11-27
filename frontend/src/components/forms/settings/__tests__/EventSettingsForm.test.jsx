import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import EventSettingsForm from '../EventSettingsForm';
import API from '../../../../api';

vi.mock('../../../../api', () => ({
  default: { getEventTeamAliases: vi.fn(), saveEventTeamAliases: vi.fn() },
}));

vi.mock('../../EventFixtureSettings', () => ({
  default: () => <div>Fixture settings</div>,
}));

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));

describe('EventSettingsForm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('edits team aliases as lines next to the fixture sources', async () => {
    API.getEventTeamAliases.mockResolvedValue({
      aliases: [['Bayern Munich', 'FC Bayern']],
    });
    API.saveEventTeamAliases.mockImplementation(async (aliases) => ({
      aliases,
    }));
    render(
      <MantineProvider>
        <EventSettingsForm />
      </MantineProvider>
    );
    const field = screen.getByLabelText('Team aliases');
    await waitFor(() => expect(field).toHaveValue('Bayern Munich = FC Bayern'));
    expect(screen.getByText('Fixture settings')).toBeInTheDocument();
    fireEvent.change(field, {
      target: { value: 'Bayern Munich = FC Bayern\nInter = Inter Milan' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save aliases' }));
    await waitFor(() =>
      expect(API.saveEventTeamAliases).toHaveBeenCalledWith([
        ['Bayern Munich', 'FC Bayern'],
        ['Inter', 'Inter Milan'],
      ])
    );
  });
});
