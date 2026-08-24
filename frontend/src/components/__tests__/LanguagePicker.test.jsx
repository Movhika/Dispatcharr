import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@mantine/core', () => ({
  Button: ({ children, onClick, disabled, 'aria-label': ariaLabel }) => (
    <button aria-label={ariaLabel} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Group: ({ children }) => <div>{children}</div>,
  Select: ({ data = [], value, onChange, 'aria-label': ariaLabel }) => (
    <select
      aria-label={ariaLabel}
      value={value || ''}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value="" />
      {data.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  Stack: ({ children }) => <div>{children}</div>,
  Text: ({ children }) => <span>{children}</span>,
}));

import LanguagePicker from '../LanguagePicker.jsx';

describe('LanguagePicker', () => {
  it('adds only a selected fixed language through the plus button', () => {
    const onChange = vi.fn();
    render(<LanguagePicker label="DUB" value={['ger']} onChange={onChange} />);

    expect(screen.getByRole('combobox')).not.toHaveTextContent('GER — German');
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'eng' },
    });
    fireEvent.click(screen.getByLabelText('Add DUB language'));

    expect(onChange).toHaveBeenCalledWith(['ger', 'eng']);
  });

  it('removes an existing language explicitly', () => {
    const onChange = vi.fn();
    render(
      <LanguagePicker label="SUB" value={['ger', 'eng']} onChange={onChange} />
    );

    fireEvent.click(screen.getByLabelText('Remove ger'));

    expect(onChange).toHaveBeenCalledWith(['eng']);
  });
});
