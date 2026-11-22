export class ConnectionSound {
  private context?: AudioContext;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private create = () => new AudioContext()) {}

  start() {
    this.stop();
    try {
      const context = this.create();
      this.context = context;
      const pulse = () => {
        if (this.context !== context || context.state !== 'running') return;
        try {
          const oscillator = context.createOscillator(), gain = context.createGain(), now = context.currentTime;
          oscillator.frequency.value = 440;
          gain.gain.setValueAtTime(0, now);
          gain.gain.linearRampToValueAtTime(0.035, now + 0.04);
          gain.gain.setValueAtTime(0.035, now + 0.2);
          gain.gain.linearRampToValueAtTime(0, now + 0.3);
          oscillator.connect(gain); gain.connect(context.destination);
          oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
          oscillator.start(now); oscillator.stop(now + 0.32);
        } catch { this.stop(); }
      };
      void context.resume().then(() => {
        if (this.context !== context) return;
        pulse();
        if (this.context === context) this.timer = setInterval(pulse, 2000);
      }).catch(() => { if (this.context === context) this.stop(); });
    } catch { this.stop(); }
  }

  stop() {
    clearInterval(this.timer); this.timer = undefined;
    const context = this.context; this.context = undefined;
    if (context) void context.close().catch(() => {});
  }
}
