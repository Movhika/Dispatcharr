import { useState } from 'react';
import { Modal } from '@mantine/core';
import ConfirmationDialog from '../ConfirmationDialog.jsx';
import M3URulesEditor from './M3URulesEditor.jsx';

const M3URulesModal = ({ opened, onClose, title, ...editorProps }) => {
  const [editorState, setEditorState] = useState({ dirty: false, busy: false });
  const [discardOpen, setDiscardOpen] = useState(false);
  const close = () => {
    setDiscardOpen(false);
    setEditorState({ dirty: false, busy: false });
    onClose();
  };
  const requestClose = () => {
    if (editorState.busy || editorState.overlayOpen) return;
    if (editorState.dirty) setDiscardOpen(true);
    else close();
  };

  if (!opened) return null;

  return (
    <>
      <Modal
        opened={opened}
        onClose={requestClose}
        title={title}
        size="min(1400px, 94vw)"
        closeOnEscape={!discardOpen && !editorState.overlayOpen}
        closeOnClickOutside={!discardOpen && !editorState.overlayOpen}
        trapFocus={!discardOpen && !editorState.overlayOpen}
        closeButtonProps={{
          'aria-label': 'Close modal',
          disabled: editorState.busy,
        }}
      >
        {opened && (
          <M3URulesEditor {...editorProps} onStateChange={setEditorState} />
        )}
      </Modal>
      <ConfirmationDialog
        opened={opened && discardOpen}
        onClose={() => setDiscardOpen(false)}
        onConfirm={close}
        title="Unsaved changes"
        message="Discard unsaved changes? The affected rows are highlighted. Already saved changes will be kept."
        cancelLabel="Keep editing"
        confirmLabel="Discard"
        zIndex={300}
      />
    </>
  );
};

export default M3URulesModal;
