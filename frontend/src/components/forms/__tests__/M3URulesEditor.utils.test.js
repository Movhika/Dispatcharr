import { describe, expect, it } from 'vitest';
import { getRuleWarnings } from '../M3URulesEditor.utils.js';
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
  it('warns about catch-all rules before later active rules, not when last', () => {
    expect(getRuleWarnings([rule(1, '.*'), rule(2, 'News')])[1][0]).toContain(
      'may hide later rules'
    );
    expect(getRuleWarnings([rule(1, 'News'), rule(2, '.*')])).toEqual({});
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
  it('warns on literal-pipe mistakes but not escaped separators', () => {
    expect(getRuleWarnings([rule(1, 'DE|'), rule(2, 'News')])[1][0]).toContain('escape a literal');
    expect(getRuleWarnings([rule(1, '^DE\\|'), rule(2, 'News')])).toEqual({});
  });
  it('does not evaluate arbitrary potentially expensive regexes in the UI', () => {
    expect(getRuleWarnings([rule(1, '(a?){100000000}'), rule(2, 'News')])).toEqual({});
  });
});
