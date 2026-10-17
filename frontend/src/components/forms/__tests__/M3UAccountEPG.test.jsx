import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import M3UAccountEPG from '../M3UAccountEPG.jsx';
import API from '../../../api.js';
import { showNotification } from '../../../utils/notificationUtils.js';

const mocks = vi.hoisted(() => ({ fetchEPGs: vi.fn() }));
vi.mock('../../../api.js', () => ({
  default: { getM3UEPG: vi.fn(), createM3UEPG: vi.fn() },
}));
vi.mock('../../../store/epgs', () => ({
  default: (selector) => selector(mocks),
}));
vi.mock('../../../utils/notificationUtils.js', () => ({
  showNotification: vi.fn(),
  hideNotification: vi.fn(),
}));

const account = { id: 7, account_type: 'XC' };
const show = (props) =>
  render(
    <MemoryRouter>
      <MantineProvider>
        <M3UAccountEPG account={account} {...props} />
      </MantineProvider>
    </MemoryRouter>
  );

describe('EPG in the account editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    API.getM3UEPG.mockResolvedValue({ source: null });
    API.createM3UEPG.mockReset();
    mocks.fetchEPGs.mockResolvedValue(undefined);
  });
  it('does not request a guide from an inactive tab', () => {
    show({ active: false });
    expect(API.getM3UEPG).not.toHaveBeenCalled();
  });
  it('offers late creation without restarting account setup', async () => {
    show();
    await screen.findByText('No matching EPG source configured.');
    API.createM3UEPG.mockResolvedValue({
      source: { id: 9, name: 'Example guide', is_active: true },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create EPG' }));
    await screen.findByText('Example guide');
    expect(API.createM3UEPG).toHaveBeenCalledExactlyOnceWith(7);
    expect(mocks.fetchEPGs).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('button', { name: 'Create EPG' })
    ).not.toBeInTheDocument();
  });
  it('shows an existing matching guide instead of another create action', async () => {
    API.getM3UEPG.mockResolvedValue({
      source: { id: 9, name: 'Existing guide', is_active: false },
    });
    show();
    await screen.findByText('Existing guide');
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Manage EPG sources' })
    ).toHaveAttribute('href', '/sources/epg');
    expect(
      screen.queryByRole('button', { name: 'Create EPG' })
    ).not.toBeInTheDocument();
  });
  it('keeps failed late creation retryable', async () => {
    API.createM3UEPG.mockRejectedValueOnce(new Error('Name already exists'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Create EPG' }));
    await waitFor(() =>
      expect(showNotification).toHaveBeenCalledWith(
        expect.objectContaining({ color: 'red', autoClose: false })
      )
    );
    expect(screen.getByRole('button', { name: 'Create EPG' })).toBeEnabled();
  });
  it('does not create twice while a request is in flight', async () => {
    let finish;
    API.createM3UEPG.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    show();
    const button = await screen.findByRole('button', { name: 'Create EPG' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(API.createM3UEPG).toHaveBeenCalledOnce();
    finish({ source: { id: 9, name: 'New guide', is_active: true } });
    await screen.findByText('New guide');
  });
  it('keeps manual EPG sources available for URL/file accounts', () => {
    show({ account: { ...account, account_type: 'STD' } });
    expect(screen.getByText(/Add a separate guide/)).toBeInTheDocument();
    expect(API.getM3UEPG).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Create EPG' })
    ).not.toBeInTheDocument();
  });
});
