import { expect, it } from 'vitest';
import { mediaRefs, localMediaPath } from '../shared/media';
import { messageText } from '../shared/core';
import { decodeRouteParameter } from '../src/useRoute';

it('ignores malformed attachment references while preserving valid encoded filenames', () => {
  const refs = mediaRefs({ role: 'assistant', content: '[bad](file:///tmp/%E0%A4%A) @file:file:///tmp/% [good](file:///tmp/report%20one.pdf)' });
  expect(refs).toEqual([{ path: '/tmp/report one.pdf', name: 'report one.pdf', image: false }]);
  for (const value of ['file:///tmp/%00.txt', 'file:///tmp/%0a.txt', 'file:///tmp/%7f.txt', {}, 3, null]) expect(localMediaPath(value)).toBeUndefined();
  const damaged = { role: 'assistant', content: [null, {}, { text: {} }, { text: 'Safe text' }, { type: 'image_url', image_url: { url: 123 } }] };
  expect(messageText(damaged)).toBe('Safe text\n[Image attachment]');
  expect(mediaRefs(damaged)).toEqual([]);
});

it('rejects invalid route parameters without throwing, preserving valid conversation identifiers', () => {
  for (const value of [undefined, '', '%', '%E0%A4%A', '%00', 'x'.repeat(301)]) expect(decodeRouteParameter(value)).toBeUndefined();
  expect(decodeRouteParameter('chat%2Fwith%20spaces')).toBe('chat/with spaces');
  expect(decodeRouteParameter('session-123')).toBe('session-123');
});
