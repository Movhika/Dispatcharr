export const isRetiredImportRule = (rule) =>
  !!rule.action && !['enable', 'disable', 'ignore'].includes(rule.action);

export const isRuleEnabled = (rule, streamFilters = false) =>
  streamFilters
    ? rule.enabled !== false
    : !!rule.enabled && !isRetiredImportRule(rule);

export const ruleResultFields = (rule) => [
  ...(rule.action !== 'keep' ? ['import'] : []),
  ...Object.keys(rule.metadata_defaults || {}),
];

// Compare identical predicates only; never execute provider regexes in the UI.
const matchIdentity = (rule, streamFilters) =>
  JSON.stringify([
    !streamFilters && rule.scope,
    streamFilters && rule.filter_type,
    rule.regex_pattern,
    streamFilters
      ? rule.custom_properties?.case_sensitive !== false
      : !!rule.case_sensitive,
  ]);

export const findDuplicateRule = (
  candidate,
  savedRules,
  streamFilters = false
) => {
  if (!isRuleEnabled(candidate, streamFilters)) return undefined;
  const identity = matchIdentity(candidate, streamFilters);
  return savedRules.find(
    (rule) =>
      String(rule.id) !== String(candidate.id) &&
      isRuleEnabled(rule, streamFilters) &&
      matchIdentity(rule, streamFilters) === identity &&
      (streamFilters ||
        ruleResultFields(rule).some((field) =>
          ruleResultFields(candidate).includes(field)
        ))
  );
};

export const ruleCheckSignature = (rules, streamFilters = false) =>
  JSON.stringify(
    rules.map((rule) => [
      String(rule.id),
      rule.order,
      matchIdentity(rule, streamFilters),
      streamFilters ? rule.exclude : rule.action,
      isRuleEnabled(rule, streamFilters),
      !streamFilters && rule.metadata_defaults,
    ])
  );

// Coverage comes from the real backend regex engine and the last refresh inventory.
// It describes this snapshot, not a proof that an expression matches every string.
export const getRuleCoverage = (rules, preview, streamFilters = false) => {
  const coverage = { causes: {}, coveredBy: {} };
  if (!preview?.inventory_count || !preview.rule_coverage) return coverage;
  const counts = new Map(
    preview.rule_coverage.map((row) => [String(row.rule_id), row.count])
  );
  const active = rules.filter((rule) => isRuleEnabled(rule, streamFilters));
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
          streamFilters && rule.filter_type,
          streamFilters ? rule.exclude : rule.action,
          streamFilters
            ? rule.custom_properties?.case_sensitive !== false
            : !!rule.case_sensitive,
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
