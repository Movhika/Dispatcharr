import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api', () => ({
  default: {
    updateVODRelationManualMetadata: vi.fn(),
    updateVODRelationTmdbMatch: vi.fn(),
  },
}));
vi.mock('../../utils/notificationUtils', () => ({
  showNotification: vi.fn(),
}));
vi.mock('../LanguagePicker.jsx', () => ({
  default: ({ label, value = [], onChange }) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={value.join(',')}
        onChange={(event) =>
          onChange(event.target.value.split(',').filter(Boolean))
        }
      />
    </label>
  ),
}));
vi.mock('../VideoFeaturePicker.jsx', () => ({
  default: ({ label, value = [], onChange }) => (
    <label>
      {label}
      <input
        aria-label={label}
        value={value.join(',')}
        onChange={(event) =>
          onChange(event.target.value.split(',').filter(Boolean))
        }
      />
    </label>
  ),
}));
vi.mock('@mantine/core', () => {
  const Wrapper = ({ children }) => <div>{children}</div>;
  return {
    Alert: Wrapper,
    Button: ({ children, onClick, disabled, loading }) => (
      <button onClick={onClick} disabled={disabled || loading}>
        {children}
      </button>
    ),
    Group: Wrapper,
    Modal: ({ opened, children, title }) =>
      opened ? (
        <div>
          <h2>{title}</h2>
          {children}
        </div>
      ) : null,
    SegmentedControl: () => null,
    Select: ({ label, value, onChange, data = [] }) => (
      <label>
        {label}
        <select
          aria-label={label}
          value={value || ''}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="" />
          {data.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>
    ),
    Stack: Wrapper,
    Text: Wrapper,
    TextInput: ({ label, description, value, onChange }) => (
      <label>
        {label}
        <input aria-label={label} value={value} onChange={onChange} />
        <span>{description}</span>
      </label>
    ),
  };
});

import API from '../../api';
import VODSourceMetadataModal from '../VODSourceMetadataModal.jsx';

const provider = {
  id: 51,
  source_asset: 90,
  m3u_account: { name: 'Provider' },
  category: { name: 'Movies' },
  movie: { tmdb_match_id: '123', tmdb_id: '123' },
  source_metadata: {
    values: {
      audio_languages: ['ger'],
      subtitle_languages: ['eng'],
      resolution: '1080p',
      container_extension: 'mkv',
      video_features: ['hdr'],
    },
    provenance: {
      audio_languages: 'category',
      subtitle_languages: 'observed',
      resolution: 'provider',
      container_extension: 'relation',
      video_features: 'observed',
    },
  },
};

describe('VODSourceMetadataModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    API.updateVODRelationManualMetadata.mockResolvedValue({
      source_asset: 90,
      source_metadata: {
        values: {
          audio_languages: ['ger'],
          subtitle_languages: ['ger'],
          resolution: '1080p',
          container_extension: 'mkv',
          video_features: ['hdr'],
        },
        provenance: { subtitle_languages: 'manual' },
      },
    });
    API.updateVODRelationTmdbMatch.mockResolvedValue({ moved_sources: 1 });
  });

  it('prefills effective metadata but keeps provider format read-only', async () => {
    const onSaved = vi.fn();
    render(
      <VODSourceMetadataModal
        provider={provider}
        contentType="movie"
        opened
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    );

    expect(screen.getByLabelText('DUB languages')).toHaveValue('ger');
    expect(screen.getByLabelText('SUB languages')).toHaveValue('eng');
    expect(screen.getByLabelText('Resolution')).toHaveValue('1080p');
    expect(screen.getByLabelText('Video features')).toHaveValue('hdr');
    expect(screen.queryByLabelText('Format')).not.toBeInTheDocument();
    expect(screen.getByText(/Format: mkv/)).toBeInTheDocument();
    expect(
      screen.getByLabelText('Canonical TMDB ID for this provider source')
    ).toHaveValue('123');

    fireEvent.change(screen.getByLabelText('SUB languages'), {
      target: { value: 'ger' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save and lock' }));

    await waitFor(() =>
      expect(API.updateVODRelationManualMetadata).toHaveBeenCalledWith(
        'movie',
        51,
        {
          audio_languages: ['ger'],
          subtitle_languages: ['ger'],
          resolution: '1080p',
          video_features: ['hdr'],
        },
        [
          'audio_languages',
          'subtitle_languages',
          'resolution',
          'video_features',
        ]
      )
    );
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 51,
        source_metadata: expect.objectContaining({
          provenance: { subtitle_languages: 'manual' },
        }),
      })
    );
  });

  it('moves only this source after changing its canonical TMDB ID', async () => {
    render(
      <VODSourceMetadataModal
        provider={provider}
        contentType="movie"
        opened
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onMoved={vi.fn()}
      />
    );

    fireEvent.change(
      screen.getByLabelText('Canonical TMDB ID for this provider source'),
      { target: { value: '76600' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save and lock' }));

    await waitFor(() =>
      expect(API.updateVODRelationTmdbMatch).toHaveBeenCalledWith(
        '76600',
        [{ content_type: 'movie', relation_id: 51 }],
        { confirmed: false }
      )
    );
  });

  it('warns before changing an enriched assignment and confirms once', async () => {
    API.updateVODRelationTmdbMatch.mockRejectedValueOnce({
      status: 409,
      body: {
        requires_confirmation: true,
        previously_enriched_sources: 1,
      },
    });
    const onMoved = vi.fn();
    render(
      <VODSourceMetadataModal
        provider={provider}
        contentType="movie"
        opened
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onMoved={onMoved}
      />
    );

    fireEvent.change(
      screen.getByLabelText('Canonical TMDB ID for this provider source'),
      { target: { value: '76600' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save and lock' }));

    expect(
      await screen.findByText(/TMDB metadata has already been fetched/)
    ).toBeInTheDocument();
    expect(API.updateVODRelationManualMetadata).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Move source' }));

    await waitFor(() =>
      expect(API.updateVODRelationTmdbMatch).toHaveBeenLastCalledWith(
        '76600',
        [{ content_type: 'movie', relation_id: 51 }],
        { confirmed: true }
      )
    );
    expect(API.updateVODRelationManualMetadata).toHaveBeenCalledTimes(1);
    expect(onMoved).toHaveBeenCalledWith({ moved_sources: 1 });
  });
});
