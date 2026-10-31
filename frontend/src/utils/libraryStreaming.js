// Offers that include a title: subscription, free or with ads.
const STREAMING_ACCESS = ['flatrate', 'free', 'ads'];

const regionEntries = (providers) =>
  Object.entries(
    providers && typeof providers === 'object' && !Array.isArray(providers)
      ? providers
      : {}
  );

// The included services of a title's TMDB data, as "REGION:id" values.
export const includedServices = (providers) => {
  const services = new Map();
  for (const [region, offers] of regionEntries(providers)) {
    for (const access of STREAMING_ACCESS) {
      if (!Array.isArray(offers?.[access])) continue;
      for (const provider of offers[access]) {
        if (!Number.isInteger(provider?.id)) continue;
        const value = `${region}:${provider.id}`;
        if (!services.has(value))
          services.set(value, { value, region, name: provider.name || value });
      }
    }
  }
  return [...services.values()];
};

export const streamingSummary = (providers) => {
  const regions = new Map();
  for (const service of includedServices(providers)) {
    if (!regions.has(service.region)) regions.set(service.region, []);
    regions.get(service.region).push(service.name);
  }
  return [...regions]
    .map(([region, names]) => `${[...new Set(names)].join(', ')} (${region})`)
    .join(' · ');
};

const regionName = (code) => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code;
  } catch {
    return code;
  }
};

// Select data grouped by region, in the given order; selected values missing
// from the services stay choosable.
export const streamingGroups = (services = [], selected = []) => {
  const groups = new Map();
  const add = (region, item) => {
    if (!groups.has(region)) groups.set(region, []);
    groups.get(region).push(item);
  };
  for (const service of services)
    add(service.region, { value: service.value, label: service.name });
  for (const value of selected) {
    if (services.some((service) => service.value === value)) continue;
    add(value.split(':')[0], { value, label: value });
  }
  return [...groups].map(([region, items]) => ({
    group: regionName(region),
    items,
  }));
};
