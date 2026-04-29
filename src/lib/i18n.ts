import defaultLocale from '../locales/default.json';

type Locale = typeof defaultLocale;

function getNestedValue(obj: Record<string, unknown>, keyPath: string): string {
  return keyPath.split('.').reduce((acc: unknown, key: string) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj) as string || keyPath;
}

function replaceParams(text: string, params: Record<string, string | number>): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    return String(params[key.trim()] ?? match);
  });
}

export function useI18n() {
  const t = (key: string, params?: Record<string, string | number>): string => {
    const text = getNestedValue(defaultLocale as unknown as Record<string, unknown>, key);
    return params ? replaceParams(text, params) : text;
  };

  return { t };
}

export function getI18n(_theme?: string) {
  const t = (key: string, params?: Record<string, string | number>): string => {
    const text = getNestedValue(defaultLocale as unknown as Record<string, unknown>, key);
    return params ? replaceParams(text, params) : text;
  };

  return { t };
}
