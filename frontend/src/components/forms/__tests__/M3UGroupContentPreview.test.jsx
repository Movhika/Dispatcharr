import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import M3UGroupContentPreview from '../M3UGroupContentPreview.jsx';
import API from '../../../api.js';
import editorClasses from '../AccountEditor.module.css';
import { showNotification } from '../../../utils/notificationUtils.js';

vi.mock('../../../api.js', () => ({
  default: { getM3UGroupContent: vi.fn() },
}));
vi.mock('../../../utils/notificationUtils.js', () => ({
  showNotification: vi.fn(),
  hideNotification: vi.fn(),
}));
const renderPreview = (props = {}) =>
  render(
    <MantineProvider>
      <M3UGroupContentPreview
        accountId={7}
        scope="live"
        group={{ channel_group: 9, name: 'Events' }}
        onClose={vi.fn()}
        {...props}
      />
    </MantineProvider>
  );

describe('M3UGroupContentPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    API.getM3UGroupContent.mockResolvedValue({
      count: 250,
      results: [{ relation_id: 1, name: 'Event stream' }],
    });
  });
  it('loads precisely the selected account, scope and group', async () => {
    renderPreview();
    await screen.findByText('Event stream');
    expect(API.getM3UGroupContent).toHaveBeenCalledWith(
      7,
      'live',
      9,
      1,
      50,
      ''
    );
  });
  it('uses a narrower responsive preview layout', () => {
    renderPreview();
    expect(screen.getByRole('dialog')).toHaveClass(
      editorClasses.previewContent
    );
  });
  it('paginates all content', async () => {
    renderPreview();
    await screen.findByText('Event stream');
    fireEvent.click(screen.getByRole('button', { name: '5' }));
    await waitFor(() =>
      expect(API.getM3UGroupContent).toHaveBeenLastCalledWith(
        7,
        'live',
        9,
        5,
        50,
        ''
      )
    );
  });
  it('searches and resets to the first page', async () => {
    renderPreview();
    await screen.findByText('Event stream');
    fireEvent.change(screen.getByLabelText('Search'), {
      target: { value: 'Football' },
    });
    await waitFor(() =>
      expect(API.getM3UGroupContent).toHaveBeenLastCalledWith(
        7,
        'live',
        9,
        1,
        50,
        'Football'
      )
    );
  });
  it('reports failures and stops loading', async () => {
    API.getM3UGroupContent.mockRejectedValue(
      new Error('Provider content unavailable')
    );
    renderPreview();
    await screen.findByText('Content could not be loaded.');
    expect(showNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Provider content unavailable',
        color: 'red',
        autoClose: false,
      })
    );
    expect(
      screen.queryByText('Provider content unavailable')
    ).not.toBeInTheDocument();
  });
  it('does not request content for a closed preview', () => {
    renderPreview({ group: null });
    expect(API.getM3UGroupContent).not.toHaveBeenCalled();
  });
  it('does not flash a spinner or zero count before loading finishes', async () => {
    API.getM3UGroupContent.mockImplementation(() => new Promise(() => {}));
    renderPreview();
    await screen.findByText('Loading imported content…');
    expect(screen.queryByText('0 imported entries')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('frames the table with a sticky header and no extra footer divider', async () => {
    renderPreview({ scope: 'movie' });
    await screen.findByText('Event stream');
    expect(screen.getByRole('table')).toHaveClass(editorClasses.categoryTable);
    expect(
      screen.getByRole('table').closest(`.${editorClasses.categoryTableFrame}`)
    ).not.toBeNull();
    expect(
      screen.getByRole('button', { name: 'Close category preview' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Close' })
    ).not.toBeInTheDocument();
  });
  it('explains an empty category', async () => {
    API.getM3UGroupContent.mockResolvedValue({ count: 0, results: [] });
    renderPreview();
    await screen.findByText('No imported entries in this category.');
    expect(screen.getByText('0 imported entries')).toBeInTheDocument();
  });
  it('retries a failed request', async () => {
    API.getM3UGroupContent.mockRejectedValueOnce(new Error('Unavailable'));
    renderPreview();
    await screen.findByText('Content could not be loaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('Event stream');
    expect(API.getM3UGroupContent).toHaveBeenCalledTimes(2);
  });
  it('ignores a response after the preview closes', async () => {
    let resolve;
    API.getM3UGroupContent.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const { unmount } = renderPreview();
    await waitFor(() => expect(API.getM3UGroupContent).toHaveBeenCalled());
    unmount();
    resolve({ count: 1, results: [{ relation_id: 1, name: 'Late result' }] });
    expect(showNotification).not.toHaveBeenCalled();
  });
});
