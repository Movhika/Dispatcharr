import React, { useMemo } from 'react';
import { Badge, Box, Group, Select, Text } from '@mantine/core';

const accountKey = (provider) =>
  String(
    provider?.m3u_account?.id ??
      provider?.account_id ??
      `name:${provider?.m3u_account?.name || 'unknown'}`
  );

const accountName = (provider) =>
  provider?.m3u_account?.name || provider?.account_name || 'Unknown account';

const categoryKey = (provider) =>
  String(provider?.category?.id ?? provider?.category_id ?? 'uncategorized');

const categoryName = (provider) =>
  provider?.category?.name || provider?.category_name || 'Uncategorized';

const sourceName = (provider) => {
  if (provider.stream_name) {
    return `${provider.stream_name}${
      provider.stream_id ? ` (Stream ${provider.stream_id})` : ''
    }`;
  }
  return provider.stream_id
    ? `Stream ${provider.stream_id}`
    : `Source ${provider.id}`;
};

const uniqueOptions = (providers, keyFor, labelFor) => {
  const seen = new Set();
  return providers.reduce((options, provider) => {
    const value = keyFor(provider);
    if (!seen.has(value)) {
      seen.add(value);
      options.push({ value, label: labelFor(provider) });
    }
    return options;
  }, []);
};

const SourceField = ({ label, options, value, onChange, disabled }) => (
  <Box style={{ minWidth: 220 }}>
    <Text size="xs" c="dimmed" mb={4}>
      {label}
    </Text>
    {options.length <= 1 ? (
      <Badge color="blue" variant="light">
        {options[0]?.label || 'Unknown'}
      </Badge>
    ) : (
      <Select
        aria-label={label}
        data={options}
        value={value}
        onChange={onChange}
        disabled={disabled}
        allowDeselect={false}
      />
    )}
  </Box>
);

const VODSourceSelectors = ({
  providers,
  selectedProvider,
  onSelect,
  disabled = false,
}) => {
  const accounts = useMemo(
    () => uniqueOptions(providers, accountKey, accountName),
    [providers]
  );
  const selectedAccount = accountKey(selectedProvider || providers[0]);
  const accountProviders = useMemo(
    () =>
      providers.filter((provider) => accountKey(provider) === selectedAccount),
    [providers, selectedAccount]
  );
  const categories = useMemo(
    () => uniqueOptions(accountProviders, categoryKey, categoryName),
    [accountProviders]
  );
  const selectedCategory = categoryKey(selectedProvider || accountProviders[0]);
  const sourceProviders = useMemo(
    () =>
      accountProviders.filter(
        (provider) => categoryKey(provider) === selectedCategory
      ),
    [accountProviders, selectedCategory]
  );

  const onAccountChange = (value) => {
    const candidates = providers.filter(
      (provider) => accountKey(provider) === value
    );
    const next =
      candidates.find(
        (provider) => categoryKey(provider) === selectedCategory
      ) || candidates[0];
    if (next) onSelect(next);
  };

  const onCategoryChange = (value) => {
    const next = accountProviders.find(
      (provider) => categoryKey(provider) === value
    );
    if (next) onSelect(next);
  };

  const sourceOptions = sourceProviders.map((provider) => ({
    value: String(provider.id),
    label: sourceName(provider),
  }));

  return (
    <Group align="flex-start" spacing="md">
      <SourceField
        label="M3U account"
        options={accounts}
        value={selectedAccount}
        onChange={onAccountChange}
        disabled={disabled}
      />
      <SourceField
        label="Category"
        options={categories}
        value={selectedCategory}
        onChange={onCategoryChange}
        disabled={disabled}
      />
      {sourceOptions.length > 1 && (
        <SourceField
          label="Source"
          options={sourceOptions}
          value={String(selectedProvider?.id || sourceProviders[0]?.id || '')}
          onChange={(value) => {
            const next = sourceProviders.find(
              (provider) => String(provider.id) === value
            );
            if (next) onSelect(next);
          }}
          disabled={disabled}
        />
      )}
    </Group>
  );
};

export default VODSourceSelectors;
