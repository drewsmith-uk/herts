import { describe, it, expect } from 'vitest';
import { applyReadingOp, cleanUrl, cleanSharedText, emptyReading, sharedUrls } from '../plugins/reading/src/model';

describe('Reading URL cleanup', () => {
  it('preserves all original bytes when disabled or no trackers match', () => {
    const url = 'https://EXAMPLE.com/a?q=a%20b&id=3&ref=feed&source=x#part?utm_source=x';
    expect(cleanUrl(url, 'off')).toBe(url);
    expect(cleanUrl(url, 'tracking')).toBe(url);
  });
  it('removes repeated and encoded tracker keys without encoding retained values again', () => {
    expect(cleanUrl('https://example.com/a?utm_source=x&q=a%20b&FBCLID=1&%75tm_medium=y&q=a+b&id=%2f#part', 'tracking'))
      .toBe('https://example.com/a?q=a%20b&q=a+b&id=%2f#part');
    for (const key of ['gclid', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'mc_cid', 'mc_eid']) {
      expect(cleanUrl(`https://example.com/?${key}=1&${key}=2#part`, 'tracking')).toBe('https://example.com/#part');
    }
  });
  it('removes all query parameters while retaining fragments', () => {
    expect(cleanUrl('https://example.com/a?id=1&utm_source=x#part?x=2', 'all')).toBe('https://example.com/a#part?x=2');
    expect(cleanUrl('https://example.com/a#part?x=2', 'all')).toBe('https://example.com/a#part?x=2');
    expect(cleanUrl('https://example.com/a?', 'all')).toBe('https://example.com/a');
  });
  it('preserves prose, punctuation and invalid links while cleaning multiple links', () => {
    const text = 'Read (https://example.com/a?utm_source=x), then https://example.com/b?id=2&fbclid=3.\nhttps://user:pass@example.com/?utm_source=x';
    const clean = cleanSharedText(text, 'tracking');
    expect(clean).toBe('Read (https://example.com/a), then https://example.com/b?id=2.\nhttps://user:pass@example.com/?utm_source=x');
    expect(sharedUrls(clean)).toEqual(['https://example.com/a', 'https://example.com/b?id=2']);
    expect(cleanSharedText(clean, 'tracking')).toBe(clean);
    expect(cleanSharedText(text, 'off')).toBe(text);
  });
  for (const mode of ['tracking', 'all'] as const) {
    it(`preserves Markdown boundaries with ${mode} cleanup`, () => {
      const original = 'https://example.com/a?utm_source=x';
      const clean = 'https://example.com/a';
      for (const wrap of [
        (url: string) => `Read **${url}** next.`,
        (url: string) => `Read *${url}* next.`,
        (url: string) => `Read _${url}_ next.`,
        (url: string) => `Read __${url}__ next.`,
        (url: string) => `Read ***${url}*** next.`,
        (url: string) => `Read ~~${url}~~ next.`,
        (url: string) => `Read \`${url}\` next.`,
        (url: string) => `Read \`\`${url}\`\` next.`,
        (url: string) => `**Read ${url}** next.`,
        (url: string) => `**Read *${url}* now.**`,
        (url: string) => `[Read](${url}) next.`,
        (url: string) => `<${url}> next.`,
        (url: string) => `\`${url}\` \`\`${url}\`\``,
      ]) {
        expect(cleanSharedText(wrap(original), mode)).toBe(wrap(clean));
        expect(sharedUrls(wrap(original))).toEqual([original]);
        expect(sharedUrls(wrap(clean))).toEqual([clean]);
        expect(cleanSharedText(wrap(original), 'off')).toBe(wrap(original));
      }
    });
  }
  it('keeps literal URL characters and encoded delimiters', () => {
    for (const path of ['a_b', 'a*b', 'a~b', 'a%60b', 'a%2Ab']) {
      const url = `https://example.com/${path}?id=a_b%2A%60&utm_source=x`;
      expect(cleanSharedText(url, 'tracking')).toBe(`https://example.com/${path}?id=a_b%2A%60`);
      expect(sharedUrls(url)).toEqual([url]);
    }
  });
  it('changes cleanup independently from download settings and existing items', () => {
    const state = applyReadingOp(emptyReading(), { id: 'create', itemId: 'item', contextId: 'context', kind: 'create', url: 'https://example.com/?utm_source=x', at: 1 });
    delete state.urlCleanup;
    const clean = applyReadingOp(state, { id: 'settings', itemId: 'settings', kind: 'settings', urlCleanup: 'tracking', at: 2 });
    expect(clean).toEqual({ ...state, urlCleanup: 'tracking' });
    const offline = applyReadingOp(clean, { id: 'offline', itemId: 'settings', kind: 'settings', autoDownload: false, at: 3 });
    expect(offline.urlCleanup).toBe('tracking');
    expect(offline.items[0].downloadVersion).toBe(state.items[0].downloadVersion + 1);
    expect(emptyReading().urlCleanup).toBe('off');
  });
});
