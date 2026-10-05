// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useConversationHistory } from '../src/useConversationHistory';

vi.mock('../src/data', () => ({
  useApp: () => ({ connectionVersion: 0 }),
  db: { kv: { get: async () => undefined } },
  cacheRead: async () => ({ cached: false, value: { sessionId: 'scroll-race', order: 'latest', offset: 0, hasMore: false, messages: [{ id: 1, role: 'assistant', content: 'History' }] } }),
}));

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

it('preserves a wheel scroll arriving before the automatic scroll frame finishes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0, resized!: ResizeObserverCallback;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resized = callback; }
    observe() {}
    disconnect() {}
  });
  const container = document.createElement('div'); document.body.append(container);
  const view = document.createElement('div'); view.className = 'conversation-scroll'; container.append(view);
  Object.defineProperties(view, { scrollHeight: { value: 3000 }, clientHeight: { value: 500 } });
  const root = createRoot(view);
  function History() {
    const history = useConversationHistory('scroll-race', 0);
    return createElement('div', { ref: history.root }, history.pages.length ? createElement('article', {
      'data-history-message': 'scroll-race:1',
      ref: (element: HTMLElement | null) => {
        if (element) element.getBoundingClientRect = () => ({ top: -view.scrollTop, bottom: 3000 - view.scrollTop } as DOMRect);
      },
    }, 'History') : null);
  }
  try {
    await act(async () => { root.render(createElement(History)); });
    expect(view.scrollTop).toBe(2500);
    // A real wheel scroll can arrive before the frame scheduled by scrollLatest.
    view.dispatchEvent(new WheelEvent('wheel', { deltaY: -1000 }));
    view.scrollTop = 1500; view.dispatchEvent(new Event('scroll'));
    // The fetched transcript changes size in the same frame.
    resized([], {} as ResizeObserver);
    const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0));
    expect(view.scrollTop).toBe(1500);
  } finally { await act(async () => root.unmount()); }
});
