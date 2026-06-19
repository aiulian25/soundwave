// Maps backend password-validator codes (APP-07) to localized messages.
// The backend returns stable `password_codes` so the SPA renders the reason in the
// user's language; falls back to the backend message or a generic localized string.

type Translate = (key: string) => string;

const CODE_TO_KEY: Record<string, string> = {
  password_too_short: 'passwordPolicy.tooShort',
  password_too_common: 'passwordPolicy.tooCommon',
  password_entirely_numeric: 'passwordPolicy.entirelyNumeric',
  password_too_similar: 'passwordPolicy.tooSimilar',
  password_same_as_current: 'passwordPolicy.sameAsCurrent',
  password_mismatch: 'passwordPolicy.mismatch',
};

/**
 * Build a localized error message from an API error for a password change/create.
 * @param err axios error
 * @param t i18next translate function
 * @param fallbackKey i18n key for the generic fallback message
 */
export function localizePasswordError(err: any, t: Translate, fallbackKey: string): string {
  const data = err?.response?.data;
  const codes: unknown = data?.password_codes;
  if (Array.isArray(codes) && codes.length > 0) {
    return codes
      .map((code) => (CODE_TO_KEY[code as string] ? t(CODE_TO_KEY[code as string]) : t('passwordPolicy.invalid')))
      .join(' ');
  }
  // No structured codes — use a backend message or the generic localized fallback.
  return data?.error || (Array.isArray(data?.password) ? data.password[0] : undefined) || t(fallbackKey);
}
