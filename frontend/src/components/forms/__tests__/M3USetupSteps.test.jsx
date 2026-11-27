import { fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { describe, expect, it, vi } from 'vitest';
import M3USetupSteps from '../M3USetupSteps.jsx';

const show = (props) => (
  <MantineProvider>
    <M3USetupSteps {...props} />
  </MantineProvider>
);

describe('manual account progress', () => {
  it('goes from the account straight to its streams', () => {
    render(show({ stage: 'account', accountType: 'MAN' }));
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByText('Account')).toBeInTheDocument();
    expect(screen.getByText('Streams')).toBeInTheDocument();
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
  });
});

describe('shared Settings and Content setup progress', () => {
  it.each([
    ['XC', ['Account', 'Settings', 'EPG', 'Content']],
    ['STD', ['Account', 'Settings', 'Content']],
  ])('keeps the established setup sequence for %s', (accountType, labels) => {
    render(show({ stage: 'account', accountType }));
    expect(screen.getAllByRole('button')).toHaveLength(labels.length);
    for (const label of labels)
      expect(screen.getByText(label)).toBeInTheDocument();
    expect(
      screen.queryByText(/Live TV|Streams|VOD|Finish/)
    ).not.toBeInTheDocument();
  });

  it.each([
    ['account', 'Account'],
    ['content', 'Settings'],
    ['epg', 'EPG'],
    ['categories', 'Content'],
  ])('resumes the saved %s step', (stage, label) => {
    render(show({ stage }));
    expect(screen.getByText(label).closest('button')).toHaveAttribute(
      'aria-current',
      'step'
    );
  });

  it('keeps Settings behind connection validation and does not skip to EPG or Content', () => {
    const onSelect = vi.fn();
    const props = { stage: 'account', onSelect };
    const { rerender } = render(show(props));
    for (const label of ['Settings', 'EPG', 'Content'])
      fireEvent.click(screen.getByText(label));
    expect(onSelect).not.toHaveBeenCalled();
    rerender(show({ ...props, contentAvailable: true }));
    fireEvent.click(screen.getByText('Settings'));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('content');
  });
});
