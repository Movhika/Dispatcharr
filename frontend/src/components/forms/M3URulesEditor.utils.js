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
export const getRuleCoverage = (rules, preview, streamFilters = false) => {
  const coverage = { causes: {}, coveredBy: {} };
  if (!preview?.inventory_count || !preview.rule_coverage) return coverage;
  const counts = new Map(
    preview.rule_coverage.map((row) => [String(row.rule_id), row.count])
  );
  const active = rules.filter((rule) => streamFilters || rule.enabled);
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
      const summary =
        count === preview.inventory_count
          ? `Matches all ${count} ${unit} from the last refresh.`
          : `Matches all ${count} remaining ${unit} from the last refresh.`;
      coverage.causes[rule.id] = {
        summary,
        message: `${summary} Check whether this is intended.${later.length ? ' Later rules have no matches in this snapshot.' : ''}`,
        // Downstream reordering does not change the cause of this warning.
        key: JSON.stringify([
          rule.id,
          rule.regex_pattern,
          streamFilters ? rule.filter_type : rule.match_field,
          streamFilters ? rule.exclude : rule.action,
          streamFilters
            ? rule.custom_properties?.case_sensitive !== false
            : !!rule.case_sensitive,
          !streamFilters && rule.match_mode,
          count,
          preview.inventory_count,
          preview.last_completed_refresh,
        ]),
      };
      for (const row of later) coverage.coveredBy[row.id] = rule.id;
    }
    remaining -= count;
  });
  return coverage;
};
