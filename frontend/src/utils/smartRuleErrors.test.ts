import { describe, expect, it } from 'vitest';
import { firstRuleError, ruleErrorsFromResponse } from './smartRuleErrors';

const t = (key: string) => key;

describe('ruleErrorsFromResponse', () => {
  it('keeps each error on the rule and field it belongs to', () => {
    const errors = ruleErrorsFromResponse({ rules: { 1: { value_2: ['reversed_range'] } } }, t);

    expect(errors[0]).toBeUndefined();
    expect(errors[1]).toEqual({ value_2: 'smartPlaylists.ruleErrors.reversedRange' });
    expect(firstRuleError(errors)).toBe('smartPlaylists.ruleErrors.reversedRange');
  });

  it('gives an unknown code a generic message', () => {
    const errors = ruleErrorsFromResponse({ rules: { 0: { value: ['something_new'] } } }, t);

    expect(errors[0].value).toBe('smartPlaylists.ruleErrors.invalid');
  });

  it('finds nothing when the response names no rule', () => {
    for (const data of [undefined, { limit: ['too small'] }, { rules: { non_field_errors: ['bad'] } }]) {
      expect(ruleErrorsFromResponse(data, t)).toEqual([]);
    }
  });
});
