let active = 0;
const waiting = new Set<() => void>();
const interruptions = new Set<() => void>();

export async function foregroundRead<T>(read: () => Promise<T>, interrupt = true): Promise<T> {
  active++;
  if (interrupt) for (const pause of interruptions) pause();
  try { return await read(); }
  finally {
    active--;
    if (!active) for (const ready of [...waiting]) ready();
  }
}

export async function waitForForeground() {
  await new Promise(resolve => setTimeout(resolve, 0));
  while (active) await new Promise<void>(resolve => {
    const ready = () => { waiting.delete(ready); resolve(); };
    waiting.add(ready);
  });
}

export function interruptBackgroundRead(interrupt: () => void) {
  interruptions.add(interrupt);
  return () => { interruptions.delete(interrupt); };
}
