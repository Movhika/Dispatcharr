import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import NameMatchingSettingsForm from '../NameMatchingSettingsForm';
import API from '../../../../api';

vi.mock('../../../../api', () => ({
  default: { getNameAliases: vi.fn(), saveNameAliases: vi.fn() },
}));

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));

describe('NameMatchingSettingsForm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('edits the global aliases as lines', async () => {
    API.getNameAliases.mockResolvedValue({ aliases: [['RTL Nitro', 'Nitro']] });
    API.saveNameAliases.mockImplementation(async (aliases) => ({ aliases }));
    render(
      <MantineProvider>
        <NameMatchingSettingsForm />
      </MantineProvider>
    );
    const field = screen.getByLabelText('Name aliases');
    await waitFor(() => expect(field).toHaveValue('RTL Nitro = Nitro'));
    fireEvent.change(field, {
      target: { value: 'RTL Nitro = Nitro\nProSieben = Pro 7 = P7' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(API.saveNameAliases).toHaveBeenCalledWith([
        ['RTL Nitro', 'Nitro'],
        ['ProSieben', 'Pro 7', 'P7'],
      ])
    );
  });
});
