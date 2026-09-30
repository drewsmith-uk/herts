import { afterEach, expect, it, vi } from 'vitest';
import { api, ApiError } from '../src/data';

afterEach(() => vi.restoreAllMocks());

it('does not turn an incomplete successful reply into data or a rejected send', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"action":', { status: 200 }));
  const error = await api('/actions', { id: 'fixture-request', kind: 'send', text: 'Retry' }).catch(error => error);
  expect(error).toBeInstanceOf(ApiError);
  expect(error.status).toBe(0); // Keep the submission journal until its receipt can be checked.
  expect(error.message).toBe('Herts returned an incomplete response. Please try again.');
});

it('preserves an explicit HTTP rejection even when the error body is unreadable', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Unavailable', { status: 503 }));
  await expect(api('/state')).rejects.toMatchObject({ status: 503, message: 'Request failed (503)' });
});
