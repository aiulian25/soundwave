import i18n from 'i18next';

const DEFAULT_LANGUAGE = 'en';
const languageOf = (locale: string) => locale.split('-')[0].toLowerCase();

/**
 * The locale for dates: the app's language, in the regional form the browser prefers for that
 * language when it has one. So an app in English shows day-first dates to someone in the UK,
 * and an app switched to Romanian shows Romanian dates even in an English browser.
 */
export function appLocale(language: string | undefined = i18n.language): string {
  const appLanguage = languageOf(language || DEFAULT_LANGUAGE);
  const browserLocales = navigator.languages?.length ? navigator.languages : [navigator.language];
  return browserLocales.find((locale) => locale && languageOf(locale) === appLanguage) ?? appLanguage;
}

type DateInput = string | number | Date;

export const formatDate = (value: DateInput, options?: Intl.DateTimeFormatOptions) =>
  new Date(value).toLocaleDateString(appLocale(), options);

export const formatDateTime = (value: DateInput) => new Date(value).toLocaleString(appLocale());
