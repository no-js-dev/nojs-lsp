/**
 * Settings
 * The `nojs` settings section as the server uses it. Editors send what the
 * user configured: VS Code sends the whole section with defaults, other
 * clients often send only some keys or `null`, so every value the server
 * reads is merged over the defaults here.
 */

export interface NoJsSettings {
  validation: { enabled: boolean };
  completion: { filters: boolean };
  customFilters: string[];
  customValidators: string[];
  devtools: { enabled: boolean; port: number; host: string };
}

export const defaultSettings: NoJsSettings = {
  validation: { enabled: true },
  completion: { filters: true },
  customFilters: [],
  customValidators: [],
  devtools: { enabled: false, port: 9222, host: 'localhost' },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pick<T>(value: unknown, fallback: T): T {
  return typeof value === typeof fallback ? (value as T) : fallback;
}

function stringList(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : fallback;
}

/** The settings the server applies for a `nojs` section received from the editor. */
export function resolveSettings(raw: unknown): NoJsSettings {
  const s = isRecord(raw) ? raw : {};
  const validation = isRecord(s.validation) ? s.validation : {};
  const completion = isRecord(s.completion) ? s.completion : {};
  const devtools = isRecord(s.devtools) ? s.devtools : {};
  return {
    validation: { enabled: pick(validation.enabled, defaultSettings.validation.enabled) },
    completion: { filters: pick(completion.filters, defaultSettings.completion.filters) },
    customFilters: stringList(s.customFilters, defaultSettings.customFilters),
    customValidators: stringList(s.customValidators, defaultSettings.customValidators),
    devtools: {
      enabled: pick(devtools.enabled, defaultSettings.devtools.enabled),
      port: pick(devtools.port, defaultSettings.devtools.port),
      host: pick(devtools.host, defaultSettings.devtools.host),
    },
  };
}
