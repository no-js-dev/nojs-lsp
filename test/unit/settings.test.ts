import * as fs from 'fs';
import * as path from 'path';
import { resolveSettings, defaultSettings } from '../../server/src/settings';

// The `nojs` section VS Code sends: every property declared in package.json, at its
// default unless the user overrode it.
function vscodeSection(overrides: Record<string, unknown>): Record<string, any> {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));
  const section: Record<string, any> = {};
  for (const [key, prop] of Object.entries<any>(pkg.contributes.configuration.properties)) {
    const parts = key.replace(/^nojs\./, '').split('.');
    let target = section;
    for (const part of parts.slice(0, -1)) target = target[part] ??= {};
    const fullKey = key.replace(/^nojs\./, '');
    target[parts[parts.length - 1]] = fullKey in overrides ? overrides[fullKey] : prop.default;
  }
  return section;
}

describe('resolveSettings', () => {
  it('returns the section VS Code sends unchanged', () => {
    const section = vscodeSection({ 'validation.enabled': false, customFilters: ['money'], 'devtools.port': 9333 });
    const { trace, ...withoutClientOnlyKeys } = section;
    expect(resolveSettings(section)).toEqual(withoutClientOnlyKeys);
    expect(trace).toEqual({ server: 'off' });
  });

  it('fills every key a partial section leaves out with its default', () => {
    expect(resolveSettings({ validation: { enabled: false } })).toEqual({ ...defaultSettings, validation: { enabled: false } });
    expect(resolveSettings({ devtools: { port: 9333 } }).devtools).toEqual({ ...defaultSettings.devtools, port: 9333 });
  });

  it('uses the defaults when the editor sends no section', () => {
    expect(resolveSettings(null)).toEqual(defaultSettings);
    expect(resolveSettings(undefined)).toEqual(defaultSettings);
  });

  it('ignores values of the wrong type', () => {
    expect(resolveSettings({ validation: { enabled: 'no' }, customFilters: 'money', completion: null })).toEqual(defaultSettings);
    expect(resolveSettings({ customValidators: ['zip', 3] }).customValidators).toEqual(['zip']);
  });
});
