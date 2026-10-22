import { useCallback, useState } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MantineProvider, Modal } from '@mantine/core';
import { describe, expect, it, vi } from 'vitest';
import VODCategoryFilter from '../VODCategoryFilter';

const fixtures = vi.hoisted(() => ({
  languages: [
    { value: 'ger', label: 'German (ger)' },
    { value: 'eng', label: 'English (eng)' },
    ...Array.from({ length: 484 }, (_, index) => ({
      value: `synthetic-${index}`,
      label: `Synthetic language ${String(index).padStart(3, '0')}`,
    })),
  ],
}));

vi.mock('../../../store/useVODStore', () => ({
  default: (select) => select({ categories: {} }),
}));
vi.mock('../../../api', () => ({
  default: {
    getVODMetadataOptions: vi.fn(async () => ({
      languages: fixtures.languages,
    })),
  },
}));

function CategoryHarness({ type, onChange, properties }) {
  const [categories, setCategories] = useState(() =>
    Array.from({ length: 4 }, (_, index) => ({
      id: index + 1,
      name: `Synthetic category ${index}`,
      enabled: true,
      custom_properties: index === 0 ? properties : {},
    }))
  );
  const updateCategories = useCallback(
    (next) => {
      onChange(next);
      setCategories(next);
    },
    [onChange]
  );
  return (
    <MantineProvider env="test">
      <Modal.Stack>
        <Modal
          opened
          onClose={() => {}}
          stackId="m3u-category-selection"
          title="Category selection"
        >
          <VODCategoryFilter
            playlist={{ id: 1 }}
            categoryStates={categories}
            setCategoryStates={updateCategories}
            type={type}
            autoEnableNewGroups={false}
            setAutoEnableNewGroups={vi.fn()}
          />
        </Modal>
      </Modal.Stack>
    </MantineProvider>
  );
}

async function renderCategories(
  type = 'movie',
  properties = { audio_languages: ['synthetic-483'], provider_field: 'keep' }
) {
  const onChange = vi.fn();
  await act(async () => {
    render(
      <CategoryHarness
        type={type}
        onChange={onChange}
        properties={properties}
      />
    );
  });
  return onChange;
}

async function openEditor(index = 0) {
  fireEvent.click(
    screen.getByRole('button', {
      name: `Edit defaults for Synthetic category ${index}`,
    })
  );
  return screen.findByRole('dialog', {
    name: `Category defaults · Synthetic category ${index}`,
  });
}

async function openPicker(field) {
  fireEvent.click(screen.getByRole('button', { name: `Choose ${field}` }));
  return screen.findByRole('dialog', { name: `Select ${field}` });
}

async function applyPicker(dialog) {
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Apply selection' })
  );
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
}

describe('VOD category metadata with real Mantine controls', () => {
  it.each(['movie', 'series'])(
    'does not mount any editor or hidden option lists for closed %s categories',
    async (type) => {
      await renderCategories(type);
      expect(
        screen.getAllByRole('button', { name: /^Edit defaults for/ })
      ).toHaveLength(4);
      expect(
        screen.queryByRole('dialog', { name: /^Category defaults/ })
      ).not.toBeInTheDocument();
      expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
      expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(
        1
      );
    }
  );

  it.each(['DUB languages', 'SUB languages'])(
    'shows common %s first and searches the full catalogue without applying immediately',
    async (field) => {
      const onChange = await renderCategories();
      await openEditor();
      const picker = await openPicker(field);
      expect(
        within(picker).getByRole('checkbox', { name: 'German (ger)' })
      ).toBeInTheDocument();
      expect(
        within(picker).queryByRole('checkbox', {
          name: 'Synthetic language 482',
        })
      ).not.toBeInTheDocument();
      fireEvent.change(
        within(picker).getByRole('textbox', { name: 'Search languages' }),
        { target: { value: 'Synthetic language 482' } }
      );
      fireEvent.click(
        within(picker).getByRole('checkbox', { name: 'Synthetic language 482' })
      );
      await applyPicker(picker);
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole('button', { name: 'Apply', exact: true })
      );
      expect(onChange).toHaveBeenCalledOnce();
      await waitFor(() =>
        expect(
          screen.queryByRole('dialog', { name: /^Category defaults/ })
        ).not.toBeInTheDocument()
      );
      const editor = await openEditor();
      expect(
        within(editor).getByRole('button', {
          name: new RegExp(`Remove Synthetic language 482 from ${field}`),
        })
      ).toBeInTheDocument();
      expect(
        within(editor).getByRole('button', {
          name: 'Remove Synthetic language 483 from DUB languages',
        })
      ).toBeInTheDocument();
    }
  );

  it('closes only the top dialog on Escape and keeps the category selection open', async () => {
    const onChange = await renderCategories();
    await openEditor();
    const picker = await openPicker('DUB languages');
    fireEvent.keyDown(
      within(picker).getByRole('button', { name: 'Close metadata selection' }),
      { key: 'Escape' }
    );
    await waitFor(() => expect(picker).not.toBeInTheDocument());
    const editor = screen.getByRole('dialog', {
      name: 'Category defaults · Synthetic category 0',
    });
    fireEvent.keyDown(
      within(editor).getByRole('button', { name: 'Close category defaults' }),
      { key: 'Escape' }
    );
    await waitFor(() => expect(editor).not.toBeInTheDocument());
    expect(
      screen.getByRole('dialog', { name: 'Category selection' })
    ).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('can show every language and retain an already selected rare language', async () => {
    await renderCategories();
    await openEditor();
    const picker = await openPicker('DUB languages');
    expect(
      within(picker).getByRole('checkbox', { name: 'Synthetic language 483' })
    ).toBeChecked();
    fireEvent.click(
      within(picker).getByRole('button', { name: 'Show all languages' })
    );
    expect(picker.querySelectorAll('input[type="checkbox"]')).toHaveLength(486);
    fireEvent.click(
      within(picker).getByRole('button', { name: 'Show common languages' })
    );
    expect(picker.querySelectorAll('input[type="checkbox"]')).toHaveLength(3);
    // Mounting the full real Mantine catalogue is expensive in jsdom when the
    // entire suite runs concurrently; keep the assertions, allow CPU contention.
  }, 15000);

  it('cancels pending picker and editor changes without touching category state', async () => {
    const onChange = await renderCategories();
    const editor = await openEditor();
    const picker = await openPicker('DUB languages');
    fireEvent.click(
      within(picker).getByRole('checkbox', { name: 'German (ger)' })
    );
    fireEvent.click(within(picker).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(picker).not.toBeInTheDocument());
    expect(
      within(editor).queryByRole('button', { name: /Remove German/ })
    ).not.toBeInTheDocument();
    fireEvent.click(within(editor).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(editor).not.toBeInTheDocument());
    expect(onChange).not.toHaveBeenCalled();
    await openEditor(1);
    expect(
      screen.queryByRole('button', { name: /Remove Synthetic language 483/ })
    ).not.toBeInTheDocument();
  });

  it('offers numeric resolutions, supports custom tags and preserves unrelated properties', async () => {
    const onChange = await renderCategories();
    await openEditor();
    fireEvent.click(screen.getByRole('textbox', { name: 'Resolution' }));
    expect(
      screen.getAllByRole('option').map((option) => option.textContent)
    ).toEqual([
      '4320p',
      '2160p',
      '1440p',
      '1080p',
      '720p',
      '576p',
      '480p',
      '360p',
    ]);
    fireEvent.click(screen.getByRole('option', { name: '360p', exact: true }));
    const picker = await openPicker('Video features');
    fireEvent.click(within(picker).getByRole('checkbox', { name: 'HDR' }));
    fireEvent.change(
      within(picker).getByRole('textbox', { name: 'Custom tag' }),
      { target: { value: 'IMAX' } }
    );
    fireEvent.click(
      within(picker).getByRole('button', { name: 'Add', exact: true })
    );
    expect(
      within(picker).getByRole('checkbox', { name: 'imax' })
    ).toBeChecked();
    await applyPicker(picker);
    fireEvent.click(screen.getByRole('button', { name: 'Apply', exact: true }));
    const next = onChange.mock.calls[0][0]([
      { id: 1, custom_properties: { provider_field: 'keep' } },
      { id: 2, custom_properties: {} },
    ]);
    expect(next[0].custom_properties).toEqual({
      provider_field: 'keep',
      audio_languages: ['synthetic-483'],
      subtitle_languages: [],
      resolution: '360p',
      video_features: ['hdr', 'custom:imax'],
    });
    expect(next[1].custom_properties).toEqual({});
  });

  it('preserves a legacy SD value without mapping it to an invented resolution', async () => {
    await renderCategories('movie', { resolution: 'SD' });
    await openEditor();
    expect(screen.getByRole('textbox', { name: 'Resolution' })).toHaveValue(
      'SD'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply', exact: true }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /^Category defaults/ })
      ).not.toBeInTheDocument()
    );
    expect(screen.getByText('SD')).toBeInTheDocument();
  });

  it('clears languages explicitly and does not resurrect a cleared legacy quality', async () => {
    const onChange = await renderCategories('movie', {
      audio_languages: ['ger'],
      quality: '1080p',
      resolution: null,
    });
    await openEditor();
    expect(screen.getByRole('textbox', { name: 'Resolution' })).toHaveValue('');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Remove German (ger) from DUB languages',
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply', exact: true }));
    const next = onChange.mock.calls[0][0]([{ id: 1, custom_properties: {} }]);
    expect(next[0].custom_properties.audio_languages).toEqual([]);
    expect(next[0].custom_properties.resolution).toBeNull();
  });
});
