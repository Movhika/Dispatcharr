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
  it('excludes paused stream filters from duplicate checks, coverage and cached signatures', () => {
    const active = rule(1, '.*', { filter_type: 'name' });
    const paused = rule(2, '.*', { filter_type: 'name', enabled: false });
    expect(findDuplicateRule(paused, [active], true)).toBeUndefined();
    expect(findDuplicateRule(active, [paused], true)).toBeUndefined();
    expect(ruleCheckSignature([active], true)).not.toBe(
      ruleCheckSignature([{ ...active, enabled: false }], true)
    );
    expect(
      getRuleCoverage(
        [paused, active],
        {
          inventory_count: 10,
          rule_coverage: [
            { rule_id: '2', count: 0 },
            { rule_id: '1', count: 10 },
          ],
        },
        true
      ).coveredBy
    ).toEqual({});
  });
  it.each(['keep'])(
    'does not let a paused %s rule block supported predicates or affect coverage',
    (action) => {
      const retired = rule(1, 'News', { action });
      expect(
        findDuplicateRule(rule(2, 'News', { action: 'enable' }), [retired])
      ).toBeUndefined();
      expect(
        getRuleCoverage([retired], {
          inventory_count: 1,
          rule_coverage: [{ rule_id: '1', count: 1 }],
        })
      ).toEqual({ causes: {}, coveredBy: {} });
    }
  );
  it('rejects duplicate import predicates even for different metadata and invalidates cached checks', () => {
    const audio = rule(1, 'GER', {
      action: 'enable',
      metadata_defaults: { audio_languages: ['ger'] },
    });
    const resolution = rule(2, 'GER', {
      action: 'enable',
      metadata_defaults: { resolution: '1080p' },
    });
    expect(findDuplicateRule(resolution, [audio])).toBe(audio);
    expect(
      findDuplicateRule(
        { ...resolution, metadata_defaults: { audio_languages: ['eng'] } },
        [audio]
      )
    ).toBe(audio);
    expect(ruleCheckSignature([audio])).not.toBe(
      ruleCheckSignature([
        { ...audio, metadata_defaults: { audio_languages: ['eng'] } },
      ])
    );
  });
  it('finds identical active predicates even with different results, excluding itself', () => {
    const saved = rule(1, 'News', { action: 'enable' });
    expect(
      findDuplicateRule(rule(2, 'News', { action: 'disable' }), [saved])
    ).toBe(saved);
    expect(findDuplicateRule(saved, [saved])).toBeUndefined();
  });
  it('distinguishes content scopes, case and disabled rules', () => {
    const saved = rule(1, 'News');
    for (const values of [
      { case_sensitive: true },
      { enabled: false },
      { scope: 'movie' },
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
  it('covers later metadata rules behind an earlier catch-all import rule', () => {
    // The first match decides the import result and all metadata.
    const coverage = getRuleCoverage(
      [
        rule(1, '.*', { action: 'enable', metadata_defaults: {} }),
        rule(2, 'DE', {
          action: 'enable',
          metadata_defaults: { audio_languages: ['ger'] },
        }),
      ],
      preview([10, 0])
    );
    expect(coverage.coveredBy).toEqual({ 2: 1 });
    expect(coverage.causes[1].summary).toContain('all 10');
  });
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
