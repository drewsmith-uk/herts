type Work = { run: () => Promise<boolean>; priority: number; attempts: number; due: number; running: boolean; first: Promise<void>; ready: () => void };

export class RecoveryQueue {
  private work = new Map<string, Work>();
  private timer?: ReturnType<typeof setTimeout>;
  private active = 0;
  private online = true;
  private closed = false;
  enqueue(key: string, run: () => Promise<boolean>, priority = 0): Promise<void> {
    if (this.closed) return run().then(() => {});
    const existing = this.work.get(key);
    if (existing) return existing.first;
    let ready!: () => void;
    const first = new Promise<void>(resolve => { ready = resolve; });
    this.work.set(key, { run, priority, attempts: 0, due: Date.now(), running: false, first, ready });
    this.pump();
    return first;
  }
  connected(online: boolean) {
    this.online = online;
    if (online) for (const work of this.work.values()) work.due = Date.now();
    this.pump();
  }
  private pump() {
    clearTimeout(this.timer);
    if (this.closed || !this.online) return;
    const pending = [...this.work].filter(([, work]) => !work.running).sort((a, b) => b[1].priority - a[1].priority);
    for (const [key, work] of pending) {
      if (this.active >= 4) break;
      if (work.due > Date.now()) continue;
      work.running = true; this.active++;
      void Promise.resolve().then(work.run).catch(() => false).then(done => {
        if (done) this.work.delete(key);
        else { work.due = Date.now() + Math.min(30000, 1000 * 2 ** Math.min(work.attempts++, 5)); }
      }).finally(() => {
        work.running = false; this.active--; work.ready(); this.pump();
      });
    }
    const due = [...this.work.values()].filter(work => !work.running).map(work => work.due);
    if (this.active < 4 && due.length) {
      this.timer = setTimeout(() => this.pump(), Math.max(0, Math.min(...due) - Date.now()));
      this.timer.unref();
    }
  }
  close() {
    this.closed = true; clearTimeout(this.timer);
    for (const work of this.work.values()) work.ready();
    this.work.clear();
  }
}
