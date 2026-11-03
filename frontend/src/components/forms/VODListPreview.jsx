import React from 'react';
import { LibraryDialog } from '../LibraryDialogs.jsx';
import LibraryPreviewModal from '../LibraryPreviewModal.jsx';
import VODListTitles from './VODListTitles.jsx';
import { previewItem } from '../../utils/vodLists';

// The titles of a list, or one of its titles in the Library preview. Loaded
// on demand like the Library, so its styles keep loading after Mantine's.
export default function VODListPreview({ list, item, onClose, onChanged }) {
  if (item)
    return <LibraryPreviewModal item={previewItem(item)} onClose={onClose} />;
  return (
    <LibraryDialog
      title={`${list.display_name} preview`}
      onClose={onClose}
      size="min(1280px, 94vw)"
    >
      <VODListTitles list={list} onChanged={onChanged} />
    </LibraryDialog>
  );
}
