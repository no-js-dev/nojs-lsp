import customData from '../../data/nojs-custom-data.json';
import directivesData from '../../server/src/data/directives.json';

/**
 * Regression guard for FIX A (newline escaping in markdown documentation).
 *
 * After JSON.parse, a correctly-authored markdown string contains REAL newline
 * characters (`\n`, 0x0A). A buggy entry that double-escaped the source (`\\n`)
 * parses into a literal backslash-n sequence (the two characters `\` + `n`),
 * which VS Code renders as raw "\n" text and breaks fenced code blocks on hover.
 *
 * This asserts that NO markdown documentation string in either data file contains
 * such a literal backslash-n sequence.
 */
const LITERAL_BACKSLASH_N = /\\n/; // a backslash char followed by the letter n

function collectDocStrings(): { source: string; name: string; value: string }[] {
  const out: { source: string; name: string; value: string }[] = [];

  // nojs-custom-data.json — globalAttributes[].description.value
  for (const attr of (customData as any).globalAttributes ?? []) {
    const desc = attr.description;
    const value = typeof desc === 'string' ? desc : desc?.value;
    if (typeof value === 'string') {
      out.push({ source: 'nojs-custom-data.json', name: attr.name, value });
    }
  }

  // directives.json — directives[].documentation and patterns[].documentation
  for (const dir of (directivesData as any).directives ?? []) {
    if (typeof dir.documentation === 'string') {
      out.push({ source: 'directives.json', name: dir.name, value: dir.documentation });
    }
  }
  for (const pat of (directivesData as any).patterns ?? []) {
    if (typeof pat.documentation === 'string') {
      out.push({ source: 'directives.json', name: pat.name, value: pat.documentation });
    }
  }

  return out;
}

describe('Data files — markdown documentation lint', () => {
  it('contains no literal backslash-n sequences in any documentation string', () => {
    const offenders = collectDocStrings()
      .filter(e => LITERAL_BACKSLASH_N.test(e.value))
      .map(e => `${e.source}:${e.name}`);
    expect(offenders).toEqual([]);
  });

  it('plugin-gated directives no longer hand-append the requirement note', () => {
    // FIX B: the note is derived from `.plugin`, not embedded in documentation.
    const leaks = ((directivesData as any).directives ?? [])
      .filter((d: any) => typeof d.documentation === 'string'
        && d.documentation.includes('Requires the `@no-js-dev'))
      .map((d: any) => d.name);
    expect(leaks).toEqual([]);
  });
});
