import { afterEach, expect, it, vi } from 'vitest';
import { ConnectionSound } from '../plugins/calls/src/sound';
afterEach(() => vi.useRealTimers());
function fixture(resume = async () => {}) {
  const oscillator = { frequency: { value: 0 }, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: undefined };
  const gain = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
  const context = { resume: vi.fn(resume), close: vi.fn(async () => {}), state: 'running', currentTime: 1, destination: {}, createOscillator: vi.fn(() => oscillator), createGain: () => gain };
  return { context, oscillator, gain, sound: new ConnectionSound(() => context as unknown as AudioContext) };
}
it('starts from the gesture, fades quiet pulses, and stops the whole audio context', async () => {
  vi.useFakeTimers(); const f = fixture(); f.sound.start();
  expect(f.context.resume).toHaveBeenCalledOnce(); await Promise.resolve();
  expect(f.oscillator.start).toHaveBeenCalledOnce();
  expect(f.gain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.035, 1.04);
  await vi.advanceTimersByTimeAsync(4000); expect(f.oscillator.start).toHaveBeenCalledTimes(3);
  f.sound.stop(); await vi.advanceTimersByTimeAsync(4000);
  expect(f.context.close).toHaveBeenCalledOnce(); expect(f.oscillator.start).toHaveBeenCalledTimes(3);
});
it('does not start delayed audio after cancellation', async () => {
  let resume!: () => void; const f = fixture(() => new Promise<void>(resolve => { resume = resolve; }));
  f.sound.start(); f.sound.stop(); resume(); await Promise.resolve();
  expect(f.oscillator.start).not.toHaveBeenCalled(); expect(f.context.close).toHaveBeenCalledOnce();
});
it('ignores browser audio refusal', async () => {
  const f = fixture(async () => { throw new Error('blocked'); });
  f.sound.start(); await Promise.resolve(); await Promise.resolve();
  expect(f.oscillator.start).not.toHaveBeenCalled(); expect(f.context.close).toHaveBeenCalledOnce();
});
