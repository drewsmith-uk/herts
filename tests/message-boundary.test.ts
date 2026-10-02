import { expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createElement, act } from 'react';
import { createRoot } from 'react-dom/client';
import { MessageBoundary } from '../src/MessageBoundary';

it('contains a broken message and recovers when that message is corrected', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.com' });
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container, { onCaughtError: () => {} });
  function Broken() { throw new Error('Synthetic renderer failure'); return null; }
  const render = (broken: boolean) => createElement('main', null,
    createElement(MessageBoundary, { revision: broken ? 'bad' : 'fixed', children: broken ? createElement(Broken) : createElement('p', null, 'Recovered message') }),
    createElement('textarea', { 'aria-label': 'Message Hermes' }), createElement('button', null, 'Stop'));
  try {
    await act(async () => root.render(render(true)));
    expect(container.textContent).toContain('This message could not be displayed.');
    expect(container.querySelector('textarea')).not.toBeNull(); expect(container.textContent).toContain('Stop');
    await act(async () => root.render(render(false)));
    expect(container.textContent).toContain('Recovered message'); expect(container.querySelector('[role=alert]')).toBeNull();
  } finally { await act(async () => root.unmount()); dom.window.close(); vi.unstubAllGlobals(); }
});
