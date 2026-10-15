import M3URulesModal from './M3URulesModal.jsx';

const M3UFilters = ({ playlist, isOpen, onClose }) => (
  <M3URulesModal
    opened={isOpen && !!playlist?.id}
    onClose={onClose}
    title="Stream filters"
    accountId={playlist?.id}
    streamFilters
  />
);

export default M3UFilters;
