import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import M3UAccountEPG from '../M3UAccountEPG.jsx';
import API from '../../../api.js';
import { showNotification } from '../../../utils/notificationUtils.js';

const mocks = vi.hoisted(() => ({ fetchEPGs: vi.fn(), epgs: {} }));
vi.mock('../../../api.js', () => ({
  default: { getM3UEPG: vi.fn(), createM3UEPG: vi.fn() },
}));
vi.mock('../../../store/epgs', () => ({
  default: Object.assign((selector) => selector(mocks), {
    getState: () => mocks,
  }),
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
    API.getM3UEPG.mockResolvedValue({ source: null, can_create: true });
    API.createM3UEPG.mockReset();
    mocks.fetchEPGs.mockResolvedValue(undefined);
    mocks.epgs = {};
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
  it('does not render EPG setup for URL/file accounts', () => {
    show({ account: { ...account, account_type: 'STD' } });
    expect(screen.queryByText('EPG source')).not.toBeInTheDocument();
    expect(API.getM3UEPG).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: 'Create EPG' })
    ).not.toBeInTheDocument();
  });

  it('only offers creation for a complete saved provider connection', async () => {
    API.getM3UEPG.mockResolvedValue({ source: null, can_create: false });
    show();
    await screen.findByText(/Complete and save the account connection/);
    expect(
      screen.queryByRole('button', { name: 'Create EPG' })
    ).not.toBeInTheDocument();
  });

  it('shows a compact source card with type, status and dimmed last refresh', async () => {
    API.getM3UEPG.mockResolvedValue({
      source: {
        id: 9,
        name: 'Example XMLTV',
        is_active: true,
        status: 'success',
        source_type: 'xmltv',
        updated_at: null,
      },
      can_create: false,
    });
    show();
    const card = await screen.findByRole('article', {
      name: 'EPG source Example XMLTV',
    });
    expect(card).toHaveTextContent('XMLTV');
    expect(card).toHaveTextContent('Success');
    expect(card).toHaveTextContent('Last refresh');
    expect(screen.getByText('Never')).toHaveAttribute('data-size', 'xs');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('prefers fresh detail data, then follows later store updates', async () => {
    const guide = {
      id: 9,
      name: 'Current guide',
      is_active: true,
      status: 'success',
    };
    mocks.epgs = { 9: { ...guide, status: 'idle' } };
    API.getM3UEPG.mockResolvedValue({ source: guide, can_create: false });
    const view = show();
    await screen.findByText('Success');
    mocks.epgs = { 9: { ...guide, status: 'fetching' } };
    view.rerender(
      <MemoryRouter>
        <MantineProvider>
          <M3UAccountEPG account={account} />
        </MantineProvider>
      </MemoryRouter>
    );
    expect(screen.getByText('Fetching')).toBeInTheDocument();
  });
});
