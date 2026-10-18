import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MantineProvider, TextInput } from '@mantine/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EPG from '../EPG.jsx';
import { addEPG, updateEPG } from '../../../utils/forms/DummyEpgUtils.js';
import {
  hideNotification,
  showNotification,
} from '../../../utils/notificationUtils.js';

vi.mock('../../SensitiveFields.jsx', () => ({
  SensitiveTextInput: (props) => <TextInput {...props} />,
  ScreenshotText: ({ children }) => <>{children}</>,
}));
vi.mock('../ScheduleInput', () => ({ default: () => null }));
vi.mock('../../../api.js', () => ({ default: {} }));
vi.mock('../../../store/epgs', () => ({
  default: Object.assign((selector) => selector({ epgs: {} }), {
    getState: () => ({ epgs: {} }),
  }),
}));
vi.mock('../../../utils/forms/DummyEpgUtils.js', () => ({
  addEPG: vi.fn(),
  updateEPG: vi.fn(),
}));
vi.mock('../../../utils/notificationUtils.js', () => ({
  showNotification: vi.fn(),
  hideNotification: vi.fn(),
}));

const show = (epg = null) =>
  render(
    <MantineProvider>
      <EPG isOpen epg={epg} onClose={vi.fn()} />
    </MantineProvider>
  );

describe('XMLTV source validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    addEPG.mockResolvedValue({ id: 9 });
    updateEPG.mockResolvedValue({ id: 9 });
  });

  it('validates on Create, marks the URL and keeps the error in a notification', async () => {
    show();
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Example guide' },
    });
    expect(showNotification).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Create', exact: true })
    );
    await waitFor(() =>
      expect(screen.getByLabelText('URL')).toHaveAttribute(
        'aria-invalid',
        'true'
      )
    );
    expect(showNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Enter an XMLTV URL or upload a file.',
        color: 'red',
        autoClose: false,
      })
    );
    expect(addEPG).not.toHaveBeenCalled();
    expect(
      screen.queryByText('Enter an XMLTV URL or upload a file.')
    ).toBeNull();

    fireEvent.change(screen.getByLabelText('URL'), {
      target: { value: 'https://example.invalid/guide.xml' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Create', exact: true })
    );
    await waitFor(() => expect(addEPG).toHaveBeenCalledOnce());
    expect(hideNotification).toHaveBeenCalledWith('epg-source-validation');
  });

  it('preserves an existing uploaded file without requiring a URL', async () => {
    show({
      id: 9,
      name: 'Uploaded guide',
      source_type: 'xmltv',
      url: '',
      file_path: '/data/uploads/epgs/guide.xml',
      refresh_interval: 24,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update EPG Source' }));
    await waitFor(() => expect(updateEPG).toHaveBeenCalledOnce());
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('does not require an XMLTV URL for Schedules Direct', async () => {
    show();
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Example guide' },
    });
    fireEvent.change(screen.getByLabelText('Source Type'), {
      target: { value: 'schedules_direct' },
    });
    addEPG.mockResolvedValue(undefined);
    fireEvent.click(
      screen.getByRole('button', { name: 'Create', exact: true })
    );
    await waitFor(() => expect(addEPG).toHaveBeenCalledOnce());
    expect(showNotification).not.toHaveBeenCalled();
  });
});
