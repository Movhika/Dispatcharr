import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import M3UAccountEPG from '../M3UAccountEPG.jsx';
import API from '../../../api.js';
import { showNotification } from '../../../utils/notificationUtils.js';
import summaryClasses from '../M3UAccountSummary.module.css';

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
      screen.queryByRole('link', { name: 'Manage EPG sources' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Create EPG' })
    ).not.toBeInTheDocument();
  });
  it.each([
    null,
    { id: 9, name: 'Setup guide', is_active: true, status: 'idle' },
  ])(
    'keeps initial setup inside the dialog, with or without a source (%s)',
    async (source) => {
      API.getM3UEPG.mockResolvedValue({ source, can_create: !source });
      show({ isInitialSetup: true });
      await screen.findByText(
        source ? source.name : 'No matching EPG source configured.'
      );
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(screen.queryByText('Manage EPG sources')).not.toBeInTheDocument();
    }
  );
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

  it('keeps unrelated sources hidden before and after creating the matching guide', async () => {
    const alternate = {
      id: 12,
      name: 'Unrelated guide',
      source_type: 'xmltv',
      is_active: true,
    };
    API.getM3UEPG.mockResolvedValue({
      source: null,
      can_create: true,
      other_sources: [alternate],
    });
    const onNext = vi.fn();
    show({ isInitialSetup: true, onNext });
    await screen.findByText('No matching EPG source configured.');
    expect(screen.queryByText('Unrelated guide')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Other configured EPG sources' })
    ).not.toBeInTheDocument();
    API.createM3UEPG.mockResolvedValue({
      source: {
        id: 9,
        name: 'Account guide',
        source_type: 'xmltv',
        is_active: true,
      },
      can_create: false,
      other_sources: [alternate],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create EPG' }));
    await screen.findByText('Account guide');
    expect(screen.queryByText('Unrelated guide')).not.toBeInTheDocument();
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('omits the entire alternative-source section when there are none', async () => {
    show({ isInitialSetup: true });
    await screen.findByText('No matching EPG source configured.');
    expect(
      screen.queryByRole('region', { name: 'Other configured EPG sources' })
    ).not.toBeInTheDocument();
  });

  it('keeps a created guide when advancing fails and retries without creating twice', async () => {
    const onNext = vi.fn().mockResolvedValue(false);
    API.createM3UEPG.mockResolvedValue({
      source: { id: 9, name: 'Saved guide', is_active: true },
      can_create: false,
    });
    show({ isInitialSetup: true, onNext });
    fireEvent.click(await screen.findByRole('button', { name: 'Create EPG' }));
    await screen.findByText('Saved guide');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalledTimes(2);
    expect(API.createM3UEPG).toHaveBeenCalledOnce();
  });

  it.each([false, true])(
    'only shows the account matching source (setup: %s)',
    async (isInitialSetup) => {
      API.getM3UEPG.mockResolvedValue({
        source: {
          id: 9,
          name: 'Matching guide',
          source_type: 'xmltv',
          is_active: true,
          status: 'success',
        },
        can_create: false,
        other_sources: [
          {
            id: 10,
            name: 'Unrelated guide',
            source_type: 'xmltv',
            is_active: true,
            status: 'idle',
          },
        ],
      });
      show({ isInitialSetup });
      const matching = await screen.findByRole('article', {
        name: 'EPG source Matching guide',
      });
      expect(matching).toHaveClass(summaryClasses.card);
      expect(screen.getAllByRole('article')).toHaveLength(1);
      expect(screen.queryByText('Unrelated guide')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('region', { name: 'Other configured EPG sources' })
      ).not.toBeInTheDocument();
      expect(screen.getAllByText('Matching EPG source')).toHaveLength(1);
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(API.createM3UEPG).not.toHaveBeenCalled();
    }
  );

  it('does not leave an empty alternative column in the normal editor', async () => {
    show();
    await screen.findByText('No matching EPG source configured.');
    expect(
      screen.queryByRole('region', { name: 'Other configured EPG sources' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'EPG source' })).toHaveClass(
      summaryClasses.card
    );
  });
});
