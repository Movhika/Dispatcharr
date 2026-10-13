import { Modal } from '@mantine/core';
import M3URulesEditor from './M3URulesEditor.jsx';

const M3UFilters = ({ playlist, isOpen, onClose }) => (
  <Modal
    opened={isOpen}
    onClose={onClose}
    title="Stream filters"
    size="min(1400px, 94vw)"
  >
    {isOpen && playlist?.id && (
      <M3URulesEditor accountId={playlist.id} streamFilters />
    )}
  </Modal>
);

export default M3UFilters;
