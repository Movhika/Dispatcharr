import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import M3UGroupFilter from '../M3UGroupFilter';
import editorClasses from '../AccountEditor.module.css';

// ── Store mocks ────────────────────────────────────────────────────────────────
vi.mock('../../../store/channels', () => ({ default: vi.fn() }));
vi.mock('../../../store/useVODStore', () => ({ default: vi.fn() }));
vi.mock('../../../hooks/useCategoryPreviewAvailability.jsx', () => ({
  default: () => ({
    availability: { live: new Set(), movie: new Set(), series: new Set() },
    hint: 'No imported entries.',
  }),
}));

// ── Utility mocks ──────────────────────────────────────────────────────────────
vi.mock('../../../utils/notificationUtils.js', () => ({
  showNotification: vi.fn(),
}));

vi.mock('../../../utils/forms/M3uGroupFilterUtils.js', () => ({
  saveAndRefreshPlaylist: vi.fn(),
  savePlaylistGroupSettings: vi.fn(),
  buildGroupStates: vi.fn(),
}));

// ── Sub-component mocks ────────────────────────────────────────────────────────
vi.mock('../LiveGroupFilter', () => ({
  default: ({ groupStates, setGroupStates }) => (
    <div data-testid="live-group-filter">
      <span data-testid="live-group-count">{groupStates?.length ?? 0}</span>
      <button
        data-testid="live-annotate-groups"
        onClick={() =>
          setGroupStates?.((rows) =>
            rows.map((row) => ({
              ...row,
              original_enabled: row.enabled,
              name: 'Updated display name',
            }))
          )
        }
      >
        Annotate Groups
      </button>
      <button
        data-testid="live-change-groups"
        onClick={() => setGroupStates?.([{ id: 99, enabled: true }])}
      >
        Change Groups
      </button>
    </div>
  ),
}));

vi.mock('../VODCategoryFilter', () => ({
  default: ({ categoryStates, setCategoryStates, type }) => (
    <div data-testid={`vod-category-filter-${type}`}>
      <span data-testid={`${type}-category-count`}>
        {categoryStates?.length ?? 0}
      </span>
      <button
        data-testid={`vod-change-${type}`}
        onClick={() => setCategoryStates?.([{ id: 55, enabled: true }])}
      >
        Change {type}
      </button>
    </div>
  ),
}));

vi.mock('../../ConfirmationDialog.jsx', () => ({
  default: ({ opened, title, onConfirm, onClose }) =>
    opened ? (
      <div role="dialog" aria-label={title}>
        <button onClick={onConfirm}>Discard</button>
        <button onClick={onClose}>Keep editing</button>
      </div>
    ) : null,
}));

// ── Mantine core ───────────────────────────────────────────────────────────────
vi.mock('@mantine/core', () => ({
  Button: ({ children, onClick, loading, disabled, variant, color }) => (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      data-loading={loading}
      data-variant={variant}
      data-color={color}
    >
      {children}
    </button>
  ),
  Flex: ({ children, component = 'div', className, 'aria-label': ariaLabel }) =>
    createElement(component, { className, 'aria-label': ariaLabel }, children),
  LoadingOverlay: ({ visible }) =>
    visible ? <div data-testid="loading-overlay" /> : null,
  Modal: ({ children, opened, onClose, title }) =>
    opened ? (
      <div data-testid="modal">
        <div data-testid="modal-title">{title}</div>
        <button data-testid="modal-close" onClick={onClose}>
          ×
        </button>
        {children}
      </div>
    ) : null,
  Stack: ({ children }) => <div>{children}</div>,
  Tabs: ({ children, defaultValue, value }) => (
    <div data-testid="tabs" data-value={value ?? defaultValue}>
      {children}
    </div>
  ),
  TabsList: ({ children }) => <div data-testid="tabs-list">{children}</div>,
  TabsPanel: ({ children, value }) => (
    <div data-testid={`tab-panel-${value}`}>{children}</div>
  ),
  TabsTab: ({ children, value, onClick }) => (
    <button data-testid={`tab-${value}`} onClick={onClick}>
      {children}
    </button>
  ),
}));

// ──────────────────────────────────────────────────────────────────────────────
// Imports after mocks
// ──────────────────────────────────────────────────────────────────────────────
import useChannelsStore from '../../../store/channels';
import useVODStore from '../../../store/useVODStore';
import { showNotification } from '../../../utils/notificationUtils.js';
import * as M3uGroupFilterUtils from '../../../utils/forms/M3uGroupFilterUtils.js';

// ── Helpers ────────────────────────────────────────────────────────────────────
const makePlaylist = (overrides = {}) => ({
  id: 1,
  name: 'Test Playlist',
  account_type: 'XC',
  enable_vod: true,
  ...overrides,
});

const makeGroup = (overrides = {}) => ({
  id: 1,
  name: 'Group A',
  playlist_id: 1,
  ...overrides,
});

const defaultProps = (overrides = {}) => ({
  playlist: makePlaylist(),
  isOpen: true,
  onClose: vi.fn(),
  ...overrides,
});

const setupStores = ({
  channelGroups = [makeGroup(), makeGroup({ id: 2, name: 'Group B' })],
  fetchCategories = vi.fn().mockResolvedValue(undefined),
} = {}) => {
  vi.mocked(useChannelsStore).mockImplementation((sel) =>
    sel({ channelGroups })
  );
  vi.mocked(useVODStore).mockImplementation((sel) => sel({ fetchCategories }));
  return { channelGroups, fetchCategories };
};

// ──────────────────────────────────────────────────────────────────────────────

describe('M3UGroupFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(M3uGroupFilterUtils.savePlaylistGroupSettings).mockResolvedValue(
      undefined
    );
    vi.mocked(M3uGroupFilterUtils.saveAndRefreshPlaylist).mockResolvedValue(
      undefined
    );
    vi.mocked(M3uGroupFilterUtils.buildGroupStates).mockReturnValue([]);
  });

  // ── Guard conditions ───────────────────────────────────────────────────────

  it('keeps category actions without a separate divider', () => {
    setupStores();
    render(<M3UGroupFilter {...defaultProps()} />);
    expect(
      screen.getByRole('contentinfo', { name: 'Category actions' })
    ).toHaveClass(editorClasses.plainFooter);
  });

  it('saves wizard selections before completing setup without handoff toasts', async () => {
    setupStores();
    const onSetupSave = vi.fn().mockResolvedValue(true);
    render(
      <M3UGroupFilter
        {...defaultProps({ isInitialSetup: true, onSetupSave })}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save selection' }));
    await waitFor(() => expect(onSetupSave).toHaveBeenCalledOnce());
    expect(
      M3uGroupFilterUtils.savePlaylistGroupSettings
    ).toHaveBeenCalledOnce();
    expect(M3uGroupFilterUtils.saveAndRefreshPlaylist).not.toHaveBeenCalled();
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('confirms discarding category changes while keeping setup resumable', () => {
    setupStores();
    const onClose = vi.fn();
    render(
      <M3UGroupFilter
        {...defaultProps({
          isInitialSetup: true,
          onSetupSave: vi.fn(),
          onClose,
        })}
      />
    );
    fireEvent.click(screen.getByTestId('live-change-groups'));
    fireEvent.click(screen.getByTestId('modal-close'));
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole('dialog', { name: 'Discard category changes?' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not treat initialized display metadata as unsaved category changes', () => {
    setupStores();
    M3uGroupFilterUtils.buildGroupStates.mockReturnValueOnce([
      { channel_group: 1, enabled: false, custom_properties: {} },
    ]);
    const onClose = vi.fn();
    render(
      <M3UGroupFilter
        {...defaultProps({
          isInitialSetup: true,
          onSetupSave: vi.fn(),
          onClose,
        })}
      />
    );
    fireEvent.click(screen.getByTestId('live-annotate-groups'));
    fireEvent.click(screen.getByTestId('modal-close'));
    expect(onClose).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('dialog', { name: 'Discard category changes?' })
    ).not.toBeInTheDocument();
  });

  describe('guard conditions', () => {
    it('does not render modal when isOpen is false', () => {
      setupStores();
      render(<M3UGroupFilter {...defaultProps({ isOpen: false })} />);
      expect(screen.queryByTestId('modal')).not.toBeInTheDocument();
    });
  });

  // ── Rendering ──────────────────────────────────────────────────────────────

  describe('rendering', () => {
    it.each(['live', 'vod-movie', 'vod-series'])(
      'opens the tab selected by its overview card: %s',
      (initialTab) => {
        setupStores();
        render(<M3UGroupFilter {...defaultProps({ initialTab })} />);
        expect(screen.getByTestId('tabs')).toHaveAttribute(
          'data-value',
          initialTab
        );
      }
    );

    it('uses the newly selected card when reopening after another content type', () => {
      setupStores();
      const props = defaultProps({ initialTab: 'vod-series' });
      const view = render(<M3UGroupFilter {...props} />);
      view.rerender(<M3UGroupFilter {...props} isOpen={false} />);
      view.rerender(<M3UGroupFilter {...props} initialTab="vod-movie" />);
      expect(screen.getByTestId('tabs')).toHaveAttribute(
        'data-value',
        'vod-movie'
      );
    });

    it('renders the modal when isOpen is true with a valid playlist', () => {
      setupStores();
      render(<M3UGroupFilter {...defaultProps()} />);
      expect(screen.getByTestId('modal')).toBeInTheDocument();
    });

    it('renders the modal title', () => {
      setupStores();
      render(<M3UGroupFilter {...defaultProps()} />);
      expect(screen.getByTestId('modal-title')).toBeInTheDocument();
      expect(screen.getByTestId('modal-title')).toHaveTextContent('Categories');
    });

    it('renders tab list with Live and VOD tabs', () => {
      setupStores();
      render(<M3UGroupFilter {...defaultProps()} />);
      expect(screen.getByTestId('tabs-list')).toBeInTheDocument();
      expect(screen.getByTestId('tab-live')).toBeInTheDocument();
      expect(screen.getByTestId('tab-vod-movie')).toBeInTheDocument();
      expect(screen.getByTestId('tab-vod-series')).toBeInTheDocument();
    });

    it('renders LiveGroupFilter panel', () => {
      setupStores();
      render(<M3UGroupFilter {...defaultProps()} />);
      expect(screen.getByTestId('live-group-filter')).toBeInTheDocument();
    });

    it('renders VODCategoryFilter panels', () => {
      setupStores();
      render(<M3UGroupFilter {...defaultProps()} />);
      expect(
        screen.getByTestId('vod-category-filter-movie')
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('vod-category-filter-series')
      ).toBeInTheDocument();
    });

    it('renders a Save button', () => {
      setupStores();
      render(<M3UGroupFilter {...defaultProps()} />);
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    });

    it('does not duplicate the modal close action in its footer', () => {
      setupStores();
      render(<M3UGroupFilter {...defaultProps()} />);
      expect(
        screen.queryByRole('button', { name: /close/i })
      ).not.toBeInTheDocument();
    });
  });

  // ── Initialization ─────────────────────────────────────────────────────────

  describe('initialization', () => {
    it('calls buildGroupStates with channelGroups and playlist on mount', async () => {
      const { channelGroups } = setupStores();
      render(<M3UGroupFilter {...defaultProps()} />);
      await waitFor(() => {
        expect(M3uGroupFilterUtils.buildGroupStates).toHaveBeenCalledWith(
          channelGroups,
          undefined
        );
      });
    });

    it('calls fetchCategories on mount', async () => {
      const { fetchCategories } = setupStores();
      render(<M3UGroupFilter {...defaultProps()} />);
      await waitFor(() => {
        expect(fetchCategories).toHaveBeenCalled();
      });
    });

    it('re-initializes when playlist prop changes', async () => {
      setupStores();
      const { rerender } = render(<M3UGroupFilter {...defaultProps()} />);
      const updatedPlaylist = makePlaylist({
        id: 2,
        name: 'Updated Playlist',
        channel_groups: [{ id: 3, name: 'Group C', playlist_id: 2 }],
      });
      rerender(
        <M3UGroupFilter {...defaultProps({ playlist: updatedPlaylist })} />
      );
      await waitFor(() => {
        expect(M3uGroupFilterUtils.buildGroupStates).toHaveBeenCalledWith(
          expect.anything(),
          updatedPlaylist.channel_groups
        );
      });
    });
  });

  // ── Close / cancel behaviour ───────────────────────────────────────────────

  describe('close / cancel behaviour', () => {
    it('calls onClose when modal X is clicked', () => {
      const onClose = vi.fn();
      setupStores();
      render(<M3UGroupFilter {...defaultProps({ onClose })} />);
      fireEvent.click(screen.getByTestId('modal-close'));
      expect(onClose).toHaveBeenCalled();
    });

    it('closing does not save or refresh', () => {
      const onClose = vi.fn();
      setupStores();
      render(<M3UGroupFilter {...defaultProps({ onClose })} />);
      fireEvent.click(screen.getByTestId('modal-close'));
      expect(onClose).toHaveBeenCalled();
      expect(
        M3uGroupFilterUtils.savePlaylistGroupSettings
      ).not.toHaveBeenCalled();
      expect(M3uGroupFilterUtils.saveAndRefreshPlaylist).not.toHaveBeenCalled();
    });
  });

  // ── LiveGroupFilter interaction ────────────────────────────────────────────

  describe('LiveGroupFilter interaction', () => {
    it('updates groupStates when LiveGroupFilter fires onGroupStatesChange', async () => {
      setupStores();
      render(<M3UGroupFilter {...defaultProps()} />);
      await waitFor(() => screen.getByTestId('live-group-filter'));
      fireEvent.click(screen.getByTestId('live-change-groups'));
      expect(screen.getByTestId('live-group-count')).toHaveTextContent('1');
    });
  });

  // ── VODCategoryFilter interaction ──────────────────────────────────────────

  describe('VODCategoryFilter interaction', () => {
    it('updates movieCategoryStates when movie VODCategoryFilter fires setCategoryStates', async () => {
      setupStores();
      render(<M3UGroupFilter {...defaultProps()} />);
      fireEvent.click(screen.getByTestId('vod-change-movie'));
      expect(screen.getByTestId('movie-category-count')).toHaveTextContent('1');
    });

    it('updates seriesCategoryStates when series VODCategoryFilter fires setCategoryStates', async () => {
      setupStores();
      render(<M3UGroupFilter {...defaultProps()} />);
      fireEvent.click(screen.getByTestId('vod-change-series'));
      expect(screen.getByTestId('series-category-count')).toHaveTextContent(
        '1'
      );
    });
  });

  // ── Save ───────────────────────────────────────────────────────────────────

  describe('saving', () => {
    it('saves current states without refreshing on an ordinary Save click', async () => {
      setupStores();
      render(<M3UGroupFilter {...defaultProps()} />);
      await waitFor(() => screen.getByRole('button', { name: /save/i }));
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
      await waitFor(() => {
        expect(
          M3uGroupFilterUtils.savePlaylistGroupSettings
        ).toHaveBeenCalledWith(
          expect.objectContaining({ id: 1 }),
          expect.any(Array),
          expect.any(Array),
          expect.any(Array),
          {},
          false
        );
      });
    });

    it('marks only the initial group save for a combined first refresh', async () => {
      setupStores();
      render(<M3UGroupFilter {...defaultProps({ isInitialSetup: true })} />);
      fireEvent.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(M3uGroupFilterUtils.saveAndRefreshPlaylist).toHaveBeenCalledWith(
          expect.objectContaining({ id: 1 }),
          expect.any(Array),
          expect.any(Array),
          expect.any(Array),
          expect.any(Object),
          true
        );
      });
    });

    it('keeps the dialog open after an ordinary save', async () => {
      const onClose = vi.fn();
      setupStores();
      render(<M3UGroupFilter {...defaultProps({ onClose })} />);
      await waitFor(() => screen.getByRole('button', { name: /save/i }));
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
      await waitFor(() => {
        expect(
          M3uGroupFilterUtils.savePlaylistGroupSettings
        ).toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
      });
    });

    it('shows success notification after saving', async () => {
      setupStores();
      render(<M3UGroupFilter {...defaultProps()} />);
      await waitFor(() => screen.getByRole('button', { name: /save/i }));
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
      await waitFor(() => {
        expect(showNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            color: expect.stringMatching(/green|teal/),
          })
        );
      });
    });

    it('explains that VOD follows the initial Live TV refresh', async () => {
      setupStores();
      render(<M3UGroupFilter {...defaultProps({ isInitialSetup: true })} />);
      fireEvent.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(showNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Live TV Refresh Started',
            message: expect.stringContaining(
              'VOD will be queued in the background after Live TV completes'
            ),
          })
        );
      });
    });

    it('does not promise a VOD refresh when the account has VOD disabled', async () => {
      setupStores();
      render(
        <M3UGroupFilter
          {...defaultProps({
            playlist: makePlaylist({ enable_vod: false }),
            isInitialSetup: true,
          })}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(showNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Live TV Refresh Started',
            message: expect.not.stringContaining('VOD'),
          })
        );
      });
    });

    it('does not call onClose when saveAndRefreshPlaylist throws', async () => {
      vi.mocked(
        M3uGroupFilterUtils.savePlaylistGroupSettings
      ).mockRejectedValue(new Error('save failed'));
      const onClose = vi.fn();
      setupStores();
      render(<M3UGroupFilter {...defaultProps({ onClose })} />);
      await waitFor(() => screen.getByRole('button', { name: /save/i }));
      fireEvent.click(screen.getByRole('button', { name: /save/i }));
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  // ── Loading state ──────────────────────────────────────────────────────────

  describe('loading state', () => {
    it('disables Save button while submitting', async () => {
      let resolveSave;
      vi.mocked(
        M3uGroupFilterUtils.savePlaylistGroupSettings
      ).mockImplementation(
        () =>
          new Promise((res) => {
            resolveSave = res;
          })
      );
      setupStores();
      render(<M3UGroupFilter {...defaultProps()} />);
      await waitFor(() => screen.getByRole('button', { name: /save/i }));

      const saveBtn = screen.getByRole('button', { name: /save/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(saveBtn.disabled || saveBtn.dataset.loading === 'true').toBe(
          true
        );
      });

      resolveSave();
    });
  });
});
