import en from './locales/en.json';
import fr from './locales/fr.json';

export const catalogs = { en, fr };
export type TextKey = keyof typeof en;
export type LanguageCode = 'fr' | 'en';
export type InterfaceLanguage = LanguageCode | 'auto';
export function valid_language(value: unknown): value is InterfaceLanguage {
  return value === 'auto' || value === 'fr' || value === 'en';
}
export function resolve_language(
  preference: InterfaceLanguage,
  system_language: string,
): LanguageCode {
  return preference === 'auto' ? (/^fr(?:-|$)/i.test(system_language) ? 'fr' : 'en') : preference;
}
export function translate(language: LanguageCode, key: TextKey, ...values: unknown[]): string {
  return catalogs[language][key].replace(/\{(\d+)\}/g, (placeholder: string, index: string) =>
    Number(index) < values.length ? String(values[Number(index)]) : placeholder,
  );
}
