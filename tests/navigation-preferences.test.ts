// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fitNavigation, navigationStorageKey, setNavigationOrder, orderedNavigation, moveNavigation } from '../src/navigationPreferences';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
  window.dispatchEvent(new StorageEvent('storage', { key: null }));
});
afterEach(() => vi.unstubAllGlobals());
describe('adaptive navigation', () => {
  it('uses exact available widths without tiny scroll regions', () => {
    expect(fitNavigation([64, 92, 64], 367)).toBe(2);
    expect(fitNavigation([64, 92, 64], 368)).toBe(3);
    expect(fitNavigation([64, 92, 64], 369)).toBe(3);
    expect(fitNavigation([64, 92, 64], 0)).toBe(0);
    expect(fitNavigation(Array(8).fill(64), 1000)).toBe(5);
  });
  it('migrates placement and preserves unavailable tabs', () => {
    expect(orderedNavigation(['reading', 'tasks', 'conversations'], {order: [], more: ['reading'], error: ''})).toEqual(['tasks', 'conversations', 'reading']);
    setNavigationOrder(['reading', 'tasks', 'conversations']);
    setNavigationOrder(['conversations', 'tasks']);
    expect(orderedNavigation(['tasks', 'reading', 'conversations'])).toEqual(['conversations', 'tasks', 'reading']);
  });
  it('retains the saved order after a failed write and permits retry', () => {
    setNavigationOrder(['reading', 'tasks']);
    const write = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('Full'); });
    setNavigationOrder(['tasks', 'reading']);
    expect(orderedNavigation(['tasks', 'reading'])).toEqual(['reading', 'tasks']);
    write.mockRestore();
    setNavigationOrder(['tasks', 'reading']);
    expect(JSON.parse(window.localStorage.getItem(navigationStorageKey)!).order).toEqual(['tasks', 'reading']);
  });
});

it('allows an empty More section to receive a tab and caps promotion', () => {
  expect(moveNavigation(['tasks', 'reading'], 2, 5, 1, 2)).toEqual({order: ['tasks', 'reading'], more: ['reading']});
  expect(moveNavigation(['tasks', 'reading'], 1, 1, 2, 0)).toEqual({order: ['reading', 'tasks'], more: ['tasks']});
  expect(moveNavigation(['tasks', 'reading'], 1, 5, 2, 1)).toEqual({order: ['tasks', 'reading'], more: []});
});
