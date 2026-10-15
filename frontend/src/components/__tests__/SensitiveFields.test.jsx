import { createRef } from 'react';
import { MantineProvider } from '@mantine/core';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ScreenshotText,
  SensitiveValue,
  SensitiveTextInput,
  SensitivePasswordInput,
} from '../SensitiveFields.jsx';
import useScreenshotMode from '../../store/useScreenshotMode.js';
import { HIDDEN_VALUE } from '../../utils/screenshotMode.js';

const url = 'https://example.invalid/live?password=example-secret';
const show = (children) =>
  render(<MantineProvider>{children}</MantineProvider>);
const toggle = () => act(() => useScreenshotMode.getState().toggle());

describe('screenshot-safe presentation', () => {
  beforeEach(() => {
    sessionStorage.clear();
    useScreenshotMode.setState({ enabled: false });
  });

  it('masks URL text and its tooltip, and restores both when switched off', async () => {
    show(<SensitiveValue withTooltip>{url}</SensitiveValue>);
    expect(screen.getByText(url)).toBeInTheDocument();
    toggle();
    const value = screen.getByText(HIDDEN_VALUE);
    expect(screen.queryByText(url)).not.toBeInTheDocument();
    fireEvent.mouseEnter(value);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(HIDDEN_VALUE);
    expect(screen.getByRole('tooltip')).not.toHaveTextContent(url);
    fireEvent.mouseLeave(value);
    toggle();
    expect(screen.getAllByText(url).length).toBeGreaterThan(0);
  });

  it('leaves usernames, public IPs and explicitly non-sensitive text unchanged', () => {
    useScreenshotMode.setState({ enabled: true });
    show(
      <>
        <SensitiveTextInput label="Username" defaultValue="ExampleUser" />
        <SensitiveTextInput label="Public IP" defaultValue="203.0.113.7" />
        <SensitiveValue sensitive={false}>ExampleUser</SensitiveValue>
      </>
    );
    expect(screen.getByLabelText('Username').type).toBe('text');
    expect(screen.getByLabelText('Username')).not.toHaveAttribute('readonly');
    expect(screen.getByLabelText('Public IP').type).toBe('text');
    expect(screen.getByText('ExampleUser')).toBeInTheDocument();
  });

  it.each([
    { label: 'Server URL', name: 'server_url' },
    { label: 'Sample', sensitive: true },
    { label: 'Target', value: url, onChange: () => {} },
    { label: 'XC Password', value: 'example-secret', onChange: () => {} },
    { label: 'Credentials', type: 'password' },
  ])(
    'masks the input without changing its submitted value: $label',
    (props) => {
      const ref = createRef();
      const submitted = vi.fn();
      const { label, ...inputProps } = props;
      show(
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitted(
              new FormData(event.currentTarget).get(inputProps.name || 'field')
            );
          }}
        >
          <SensitiveTextInput
            name="field"
            label={label}
            defaultValue={inputProps.value === undefined ? url : undefined}
            {...inputProps}
            ref={ref}
          />
          <button type="submit">Save</button>
        </form>
      );
      const input = screen.getByLabelText(label);
      const original = input.value;
      expect(ref.current).toBe(input);
      toggle();
      expect(input).toHaveAttribute('type', 'password');
      expect(input).toHaveAttribute('readonly');
      expect(input).toHaveValue(original);
      fireEvent.click(screen.getByText('Save'));
      expect(submitted).toHaveBeenCalledWith(original);
      toggle();
      expect(input).not.toHaveAttribute('readonly');
      expect(input.type).toBe(props.type || 'text');
    }
  );

  it('overrides an already revealed password and disables its reveal control', () => {
    const { container } = show(
      <SensitivePasswordInput
        label="Password"
        defaultValue="example-secret"
        visible
      />
    );
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'text');
    toggle();
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveValue('example-secret');
    expect(input).toHaveAttribute('readonly');
    expect(container.querySelector('button')).toBeDisabled();
    toggle();
    expect(input).toHaveAttribute('type', 'text');
    expect(container.querySelector('button')).not.toBeDisabled();
  });

  it('redacts URL literals inside nested messages without changing other text', () => {
    show(
      <ScreenshotText>
        Failed: <strong>{url}</strong> for ExampleUser (203.0.113.7)
      </ScreenshotText>
    );
    expect(screen.getByText(url)).toBeInTheDocument();
    toggle();
    expect(screen.queryByText(url)).not.toBeInTheDocument();
    expect(screen.getByText(HIDDEN_VALUE).tagName).toBe('STRONG');
    expect(
      screen.getByText(/for ExampleUser \(203.0.113.7\)/)
    ).toBeInTheDocument();
  });
});
