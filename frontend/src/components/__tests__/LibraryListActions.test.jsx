import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider, Modal } from '@mantine/core';
import { AddToListDialog, SaveAsListDialog } from '../LibraryListActions.jsx';
import api from '../../api';

vi.mock('../../utils/notificationUtils.js', () => ({
  showNotification: vi.fn(),
}));
vi.mock('../../api', () => ({
  default: {
    getVODLists: vi.fn(),
    saveVODList: vi.fn(),
    editVODListItems: vi.fn(),
  },
}));

const wrap = (children) =>
  render(
    <MantineProvider>
      <Modal.Stack>{children}</Modal.Stack>
    </MantineProvider>
  );

describe('Library list actions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('adds exact sources to a new manual list', async () => {
    api.getVODLists.mockResolvedValue([
      { id: 2, name: 'Rules', display_name: 'Rules', list_type: 'rules' },
    ]);
    api.saveVODList.mockResolvedValue({ id: 8, name: 'Picks' });
    api.editVODListItems.mockResolvedValue({ id: 8, name: 'Picks' });
    const onClose = vi.fn();
    const selection = { items: [{ content_type: 'movie', id: 31 }] };
    wrap(
      <AddToListDialog
        selection={selection}
        sources
        count={1}
        onClose={onClose}
      />
    );
    // Only manual lists are offered; without one a new list is created.
    const name = await screen.findByRole('textbox', { name: /List name/ });
    fireEvent.change(name, { target: { value: 'Picks' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.saveVODList).toHaveBeenCalledWith({
      name: 'Picks',
      list_type: 'manual',
    });
    expect(api.editVODListItems).toHaveBeenCalledWith(8, 'add-items', {
      ...selection,
      sources: true,
    });
  });

  it('saves the Library filters as a rules list', async () => {
    api.saveVODList.mockResolvedValue({ id: 9, name: 'Anime {season}' });
    const onClose = vi.fn();
    wrap(
      <SaveAsListDialog
        filters={{
          type: 'series',
          view: 'titles',
          search: '',
          anime_mode: 'only',
          released_period: 'current_season',
        }}
        onClose={onClose}
      />
    );
    fireEvent.change(screen.getByRole('textbox', { name: /List name/ }), {
      target: { value: 'Anime {season}' },
    });
    expect(screen.getByText(/^Shown as: Anime /)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api.saveVODList).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Anime {season}',
        list_type: 'rules',
        content_type: 'series',
        filters: { anime_mode: 'only', released_period: 'current_season' },
        refresh_interval: 0,
      })
    );
  });
});
