import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import M3UGroupContentPreview from '../M3UGroupContentPreview.jsx';
import API from '../../../api.js';
import editorClasses from '../AccountEditor.module.css';

vi.mock('../../../api.js', () => ({
  default: { getM3UGroupContent: vi.fn() },
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
    expect(
      await screen.findByText('Provider content unavailable')
    ).toBeInTheDocument();
  });
  it('does not request content for a closed preview', () => {
    renderPreview({ group: null });
    expect(API.getM3UGroupContent).not.toHaveBeenCalled();
  });
});
