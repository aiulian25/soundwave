import { afterEach, describe, expect, it, vi } from 'vitest';
import { appLocale, formatDate } from './formatDate';

const browserPrefers = (...locales: string[]) => vi.stubGlobal('navigator', { languages: locales, language: locales[0] });

describe('dates follow the app language, not only the browser', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the browser\'s own regional form of the app language', () => {
    browserPrefers('en-GB', 'ro-RO');
    expect(appLocale('en')).toBe('en-GB');
    expect(appLocale('ro')).toBe('ro-RO');
  });

  it('uses the app language when the browser speaks another one', () => {
    browserPrefers('en-US');
    expect(appLocale('ro')).toBe('ro');
  });

  it('falls back to English when no language is set yet', () => {
    browserPrefers('de-DE');
    expect(appLocale(undefined)).toBe('en');
    expect(appLocale('')).toBe('en');
  });

  it('writes the month in the app language', () => {
    browserPrefers('en-US');
    const june = new Date(2026, 5, 15);
    expect(new Date(june).toLocaleDateString(appLocale('ro'), { month: 'long' })).toBe('iunie');
    expect(formatDate(june, { month: 'long' })).toBe('June');
  });
});
