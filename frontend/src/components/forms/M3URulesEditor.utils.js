// Hints only: the backend remains authoritative for regex validation.
export const getRuleWarnings = (rules, streamFilters = false) => {
  const warnings = {};
  const identities = new Map();
  const add = (id, message) => {
    warnings[id] = [...new Set([...(warnings[id] || []), message])];
  };
  rules.forEach((rule, index) => {
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
    if (!rules.slice(index + 1).some((row) => streamFilters || row.enabled))
      return;
    if (!streamFilters && rule.match_field !== 'group_name') return;
    const pattern = rule.regex_pattern;
    // Recognize common catch-alls without running user regexes in the UI.
    const catchAll = ['.*', '^.*', '.*$', '^.*$', '^', '$'].includes(pattern);
    const emptyAlternative =
      pattern.endsWith('|') &&
      !pattern.endsWith('\\|') &&
      !pattern.includes('[');
    if (catchAll || emptyAlternative)
      add(
        rule.id,
        'This expression matches an empty string and may hide later rules. Put catch-all rules last; escape a literal | as \\|.'
      );
  });
  return warnings;
};
