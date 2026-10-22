import { useCallback, useState } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { describe, expect, it, vi } from 'vitest';
import VODCategoryFilter from '../VODCategoryFilter';

const fixtures = vi.hoisted(() => ({
  languages: Array.from({ length: 486 }, (_, index) => ({
    value: `synthetic-${index}`,
    label: `Synthetic language ${String(index).padStart(3, '0')}`,
  })),
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

function CategoryHarness({ type, onChange }) {
  const [categories, setCategories] = useState(() =>
    Array.from({ length: 4 }, (_, index) => ({
      id: index + 1,
      name: `Synthetic category ${index}`,
      enabled: true,
      custom_properties:
        index === 0 ? { audio_languages: ['synthetic-485'] } : {},
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
      <VODCategoryFilter
        playlist={{ id: 1 }}
        categoryStates={categories}
        setCategoryStates={updateCategories}
        type={type}
        autoEnableNewGroups={false}
        setAutoEnableNewGroups={vi.fn()}
      />
    </MantineProvider>
  );
}

async function renderCategories(type = 'movie') {
  const onChange = vi.fn();
  await act(async () => {
    render(<CategoryHarness type={type} onChange={onChange} />);
  });
  return onChange;
}

describe('VODCategoryFilter with real Mantine dropdowns', () => {
  it.each(['movie', 'series'])(
    'does not mount closed dropdown options for %s categories',
    async (type) => {
      await renderCategories(type);

      expect(screen.getAllByPlaceholderText('Audio languages')).toHaveLength(4);
      expect(screen.getByText('Synthetic language 485')).toBeInTheDocument();
      // Query the DOM, including hidden nodes: role queries alone would miss
      // the hundreds of invisible options that caused the browser freeze.
      expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
    }
  );

  it.each(['Audio languages', 'Subtitle languages'])(
    'limits an open %s list without truncating its searchable catalogue',
    async (placeholder) => {
      const onChange = await renderCategories();
      const input = screen.getAllByPlaceholderText(placeholder)[0];
      fireEvent.focus(input);

      await waitFor(() => {
        expect(document.querySelectorAll('[role="option"]')).toHaveLength(50);
      });
      fireEvent.change(input, { target: { value: 'Synthetic language 484' } });
      const option = await screen.findByRole('option', {
        name: 'Synthetic language 484',
      });
      fireEvent.click(option);
      expect(onChange).toHaveBeenCalledOnce();
      fireEvent.blur(input);

      await waitFor(() => {
        expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
      });
      expect(screen.getByText('Synthetic language 484')).toBeInTheDocument();
      expect(screen.getByText('Synthetic language 485')).toBeInTheDocument();
    }
  );
});
