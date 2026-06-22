import { describe, it, expect } from 'vitest';
import { localizePasswordError } from './passwordErrors';

// Identity translator: returns the i18n key so we can assert which key was chosen.
const t = (key: string) => key;

describe('localizePasswordError', () => {
  it('maps known password_codes to their localized keys', () => {
    const err = { response: { data: { password_codes: ['password_too_short', 'password_too_common'] } } };
    expect(localizePasswordError(err, t, 'fallback')).toBe(
      'passwordPolicy.tooShort passwordPolicy.tooCommon',
    );
  });

  it('maps an unknown code to the generic invalid key', () => {
    const err = { response: { data: { password_codes: ['brand_new_code'] } } };
    expect(localizePasswordError(err, t, 'fallback')).toBe('passwordPolicy.invalid');
  });

  it('falls back to the backend error message when there are no codes', () => {
    const err = { response: { data: { error: 'Backend rejected it' } } };
    expect(localizePasswordError(err, t, 'fallback')).toBe('Backend rejected it');
  });

  it('falls back to data.password[0] when present', () => {
    const err = { response: { data: { password: ['Too weak'] } } };
    expect(localizePasswordError(err, t, 'fallback')).toBe('Too weak');
  });

  it('falls back to the localized fallback key when nothing else is available', () => {
    expect(localizePasswordError({}, t, 'someFallback.key')).toBe('someFallback.key');
  });
});
