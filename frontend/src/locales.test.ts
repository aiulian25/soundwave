import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type Translations = { [key: string]: string | Translations };

const load = (language: string): Translations =>
  JSON.parse(readFileSync(resolve(__dirname, `../public/locales/${language}/translation.json`), 'utf8'));

function flatten(node: Translations, prefix = ''): Record<string, string> {
  return Object.entries(node).reduce<Record<string, string>>((flat, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? { ...flat, [path]: value } : { ...flat, ...flatten(value, path) };
  }, {});
}

const PLURAL_SUFFIX = /_(one|few|other)$/;
// What each language's grammar needs: Romanian counts 2-19 and 20+ differently ("2 melodii", "20 de melodii").
const PLURAL_FORMS: Record<string, string[]> = { en: ['one', 'other'], ro: ['few', 'one', 'other'] };
// Spellings that are only ever a Romanian word written without its diacritics.
const UNDIACRITISED = /(^|[^\p{L}\d])(si|sa|fara|dupa|pana|cand|setari|sterge|inca|daca|fisier|fisiere|cauta|descarca)(?![\p{L}\d])/iu;

const english = flatten(load('en'));
const romanian = flatten(load('ro'));
const messagesOf = (strings: Record<string, string>) => new Set(Object.keys(strings).map((key) => key.replace(PLURAL_SUFFIX, '')));

function pluralFamilies(strings: Record<string, string>): Record<string, string[]> {
  return Object.keys(strings)
    .filter((key) => PLURAL_SUFFIX.test(key))
    .reduce<Record<string, string[]>>((families, key) => {
      const message = key.replace(PLURAL_SUFFIX, '');
      const form = key.match(PLURAL_SUFFIX)![1];
      return { ...families, [message]: [...(families[message] ?? []), form].sort() };
    }, {});
}

describe('translations', () => {
  it('both languages have the same messages', () => {
    const englishMessages = messagesOf(english);
    const romanianMessages = messagesOf(romanian);

    expect([...englishMessages].filter((message) => !romanianMessages.has(message))).toEqual([]);
    expect([...romanianMessages].filter((message) => !englishMessages.has(message))).toEqual([]);
  });

  it.each(Object.entries({ en: english, ro: romanian }))('every counted message in %s has all its plural forms', (language, strings) => {
    const incomplete = Object.entries(pluralFamilies(strings)).filter(([, forms]) => forms.join() !== PLURAL_FORMS[language].join());

    expect(incomplete).toEqual([]);
  });

  it('a message that counts something keeps the count in every form', () => {
    const withoutCount = Object.entries({ ...english, ...romanian })
      .filter(([key]) => /_(few|other)$/.test(key))
      .filter(([, text]) => !text.includes('{{count}}'));

    expect(withoutCount).toEqual([]);
  });

  it('Romanian is written with its diacritics', () => {
    const outsidePlaceholders = (text: string) => text.replace(/\{\{[^}]*\}\}/g, ' ');
    const plain = Object.entries(romanian).filter(([, text]) => UNDIACRITISED.test(outsidePlaceholders(text)));

    expect(plain).toEqual([]);
  });

  it('the commonest counts read correctly in Romanian', () => {
    expect(romanian['library.trackCount_one']).toBe('{{count}} melodie în biblioteca ta');
    expect(romanian['library.trackCount_few']).toBe('{{count}} melodii în biblioteca ta');
    expect(romanian['library.trackCount_other']).toBe('{{count}} de melodii în biblioteca ta');
  });
});
