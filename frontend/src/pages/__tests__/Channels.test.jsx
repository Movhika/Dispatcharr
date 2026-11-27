import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import useAuthStore from '../../store/auth';
import ChannelsPage from '../Channels';

vi.mock('../../store/auth');
vi.mock('../../components/tables/ChannelsTable', () => ({
  default: () => <div data-testid="channels-table">ChannelsTable</div>,
}));
vi.mock('../../components/tables/StreamsTable', () => ({
  default: () => <div data-testid="streams-table">StreamsTable</div>,
}));
vi.mock('@mantine/core', () => ({
  Box: ({ children, ...props }) => <div {...props}>{children}</div>,
}));

describe('ChannelsPage', () => {
  it('renders nothing when user is not authenticated', () => {
    useAuthStore.mockReturnValue({ id: null, user_level: 0 });
    const { container } = render(<ChannelsPage />);
    expect(container.firstChild).toBeNull();
  });

  it.each([1, 10])(
    'shows one channel list without a streams panel for level %s',
    (level) => {
      useAuthStore.mockReturnValue({ id: 1, user_level: level });
      render(<ChannelsPage />);
      expect(screen.getByTestId('channels-table')).toBeInTheDocument();
      expect(screen.queryByTestId('streams-table')).not.toBeInTheDocument();
    }
  );
});
