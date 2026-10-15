import { describe, expect, it } from 'vitest';
import {
  findDuplicateRule,
  getRuleCoverage,
  ruleCheckSignature,
} from '../M3URulesEditor.utils.js';
const rule = (id, regex_pattern, props = {}) => ({
  id,
  regex_pattern,
  enabled: true,
  match_field: 'group_name',
  case_sensitive: false,
  ...props,
});
describe('save-time duplicate validation', () => {
  it('finds identical active predicates even with different results, excluding itself', () => {
    const saved = rule(1, 'News', { action: 'enable' });
    expect(
      findDuplicateRule(rule(2, 'News', { action: 'disable' }), [saved])
    ).toBe(saved);
    expect(findDuplicateRule(saved, [saved])).toBeUndefined();
  });
  it('does not confuse matching modes, case or disabled rules', () => {
    const saved = rule(1, 'News');
    for (const values of [
      { case_sensitive: true },
      { enabled: false },
      { scope: 'movie' },
      { match_field: 'item_name', match_mode: 'all' },
    ])
      expect(
        findDuplicateRule(rule(2, 'News', values), [saved])
      ).toBeUndefined();
    expect(
      findDuplicateRule(rule(2, 'News'), [rule(1, 'News', { enabled: false })])
    ).toBeUndefined();
  });
  it('does not block Python-only or invalid regex syntax', () => {
    expect(
      findDuplicateRule(rule(1, '(?i)News'), [rule(2, '[')])
    ).toBeUndefined();
  });
  it('distinguishes stream filter targets', () => {
    expect(
      findDuplicateRule(
        rule(1, 'News', { filter_type: 'name' }),
        [rule(2, 'News', { filter_type: 'url' })],
        true
      )
    ).toBeUndefined();
  });
  it('does not evaluate arbitrary potentially expensive regexes in the UI', () => {
    expect(
      findDuplicateRule(rule(1, '(a?){100000000}'), [rule(2, 'News')])
    ).toBeUndefined();
  });
  it('signs only relevant matching fields, results, identities and order', () => {
    const saved = rule(1, 'News', {
      filter_type: 'name',
      order: 0,
      custom_properties: { case_sensitive: false, note: 'one' },
    });
    expect(ruleCheckSignature([saved], true)).toBe(
      ruleCheckSignature(
        [
          {
            ...saved,
            custom_properties: { note: 'two', case_sensitive: false },
          },
        ],
        true
      )
    );
    expect(ruleCheckSignature([saved], true)).not.toBe(
      ruleCheckSignature([{ ...saved, order: 1 }], true)
    );
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
