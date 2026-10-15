import { describe, expect, it } from 'vitest';
import { getRuleWarnings, getRuleCoverage } from '../M3URulesEditor.utils.js';
const rule = (id, regex_pattern, props = {}) => ({
  id,
  regex_pattern,
  enabled: true,
  match_field: 'group_name',
  case_sensitive: false,
  ...props,
});
describe('rule editing hints', () => {
  it('warns on duplicate active matches even with different results', () => {
    const warnings = getRuleWarnings([
      rule(1, 'News', { action: 'enable' }),
      rule(2, 'News', { action: 'disable' }),
    ]);
    expect(warnings[1][0]).toContain('identical match');
    expect(warnings[2][0]).toContain('identical match');
  });
  it('does not confuse matching modes, case or disabled rules', () => {
    expect(
      getRuleWarnings([
        rule(1, 'News'),
        rule(2, 'News', { case_sensitive: true }),
        rule(3, 'News', { enabled: false }),
      ])
    ).toEqual({});
    expect(
      getRuleWarnings([
        rule(1, 'News', { match_field: 'item_name', match_mode: 'any' }),
        rule(2, 'News', { match_field: 'item_name', match_mode: 'all' }),
      ])
    ).toEqual({});
  });
  it('does not block Python-only or invalid regex syntax', () => {
    expect(getRuleWarnings([rule(1, '(?i)News'), rule(2, '[')])).toEqual({});
  });
  it('distinguishes stream filter targets', () => {
    expect(
      getRuleWarnings(
        [
          rule(1, 'News', { filter_type: 'name' }),
          rule(2, 'News', { filter_type: 'url' }),
        ],
        true
      )
    ).toEqual({});
  });
  it('does not evaluate arbitrary potentially expensive regexes in the UI', () => {
    expect(
      getRuleWarnings([rule(1, '(a?){100000000}'), rule(2, 'News')])
    ).toEqual({});
  });
});

describe('inventory-based regex coverage', () => {
  const preview = (counts) => ({
    inventory_count: 10,
    rule_coverage: counts.map((count, index) => ({
      rule_id: String(index + 1),
      count,
    })),
  });
  it.each(['News|Sport', '[\\s\\S]+', '.*', '(?i)news|sport'])(
    'uses actual counts, not a special pattern check: %s',
    (pattern) => {
      const coverage = getRuleCoverage(
        [rule(1, pattern), rule(2, 'Sport')],
        preview([10, 0])
      );
      expect(coverage.causes[1].summary).toContain('Matches all 10 categories');
      expect(coverage.causes[2]).toBeUndefined();
      expect(coverage.coveredBy).toEqual({ 2: 1 });
    }
  );
  it('does not infer universality or warn about ordinary partial matches', () => {
    expect(
      getRuleCoverage([rule(1, '.*'), rule(2, 'Sport')], preview([3, 4]))
    ).toEqual({ causes: {}, coveredBy: {} });
    expect(
      getRuleCoverage([rule(1, '.*')], {
        inventory_count: 0,
        rule_coverage: [],
      })
    ).toEqual({ causes: {}, coveredBy: {} });
  });
  it('warns when a non-final rule consumes the remaining inventory, not a normal final fallback', () => {
    const rows = [rule(1, 'News'), rule(2, 'Sport'), rule(3, 'Events')];
    expect(
      getRuleCoverage(rows, preview([3, 7, 0])).causes[2].summary
    ).toContain('all 7 remaining');
    expect(getRuleCoverage(rows.slice(0, 2), preview([3, 7]))).toEqual({
      causes: {},
      coveredBy: {},
    });
  });
  it('does not mark disabled rules as covered', () => {
    const coverage = getRuleCoverage(
      [
        rule(1, 'News|Sport'),
        rule(2, 'Sport', { enabled: false }),
        rule(3, 'News'),
      ],
      preview([10, 0, 0])
    );
    expect(coverage.coveredBy).toEqual({ 3: 1 });
  });
  it('keeps the cause identity stable when only covered rows move', () => {
    const rows = [rule(1, 'News|Sport'), rule(2, 'Sport'), rule(3, 'News')];
    const first = getRuleCoverage(rows, preview([10, 0, 0]));
    const second = getRuleCoverage(
      [rows[0], rows[2], rows[1]],
      preview([10, 0, 0])
    );
    expect(first.causes[1].key).toBe(second.causes[1].key);
  });
});
