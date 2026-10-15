// Hints only: the backend remains authoritative for regex validation.
export const getRuleWarnings = (rules, streamFilters = false) => {
  const warnings = {};
  const identities = new Map();
  const add = (id, message) => {
    warnings[id] = [...new Set([...(warnings[id] || []), message])];
  };
  rules.forEach((rule) => {
    if (!rule.regex_pattern?.trim() || (!streamFilters && !rule.enabled))
      return;
    const identity = JSON.stringify([
      streamFilters ? rule.filter_type : rule.match_field,
      !streamFilters && rule.match_field === 'item_name'
        ? rule.match_mode
        : 'any',
      rule.regex_pattern,
      streamFilters
        ? rule.custom_properties?.case_sensitive !== false
        : !!rule.case_sensitive,
    ]);
    if (identities.has(identity)) {
      const message =
        'An identical match already exists. The first matching rule wins.';
      add(identities.get(identity), message);
      add(rule.id, message);
    } else identities.set(identity, rule.id);
  });
  return warnings;
};

// Coverage comes from the real backend regex engine and the last refresh inventory.
// It describes this snapshot, not a proof that an expression matches every string.
export const getCoverageWarnings = (rules, preview, streamFilters = false) => {
  if (!preview?.inventory_count || !preview.rule_coverage) return {};
  const counts = new Map(
    preview.rule_coverage.map((row) => [String(row.rule_id), row.count])
  );
  const active = rules.filter((rule) => streamFilters || rule.enabled);
  const warnings = {};
  const unit = streamFilters ? 'streams' : 'categories';
  let remaining = preview.inventory_count;
  active.forEach((rule, index) => {
    const count = counts.get(String(rule.id)) || 0;
    const later = active.slice(index + 1);
    if (
      remaining > 0 &&
      count === remaining &&
      (later.length || count === preview.inventory_count)
    ) {
      const message =
        count === preview.inventory_count
          ? `This rule matches all ${count} ${unit} from the last refresh. Check whether this is intended.`
          : `This rule matches all ${count} remaining ${unit} from the last refresh.`;
      const detail = later.length
        ? ' Later rules have no matches in this snapshot.'
        : '';
      for (const row of [rule, ...later]) warnings[row.id] = [message + detail];
    }
    remaining -= count;
  });
  return warnings;
};
