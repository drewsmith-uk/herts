import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { z } from 'zod';

export interface NativeGatewayOptions { home: string; python: string; source: string }
const endpointSchema = z.object({ profile_id: z.string(), instance_id: z.string().min(1), authority_epoch: z.number().int().nonnegative(),
  runtime_protocol: z.literal(1), api_origin: z.string().url(), capabilities: z.array(z.string()), control_home: z.string().nullish() });
export type NativeEndpoint = z.infer<typeof endpointSchema>;
export class NativeGateway {
  private child?: ChildProcessWithoutNullStreams;
  private sequence = 0;
  private pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  constructor(private options: NativeGatewayOptions) {}
  private start() {
    if (this.child) return this.child;
    const child = spawn(this.options.python, ['-P', '-u', fileURLToPath(new URL('../scripts/hermes-gateway.py', import.meta.url))], {
      cwd: this.options.source, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HERMES_HOME: this.options.home, PYTHONPATH: this.options.source,
        PYTHONDONTWRITEBYTECODE: '1', HERMES_DISABLE_LAZY_INSTALLS: '1' },
    });
    this.child = child;
    let buffer = '';
    child.stderr.resume(); child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 262144) { this.close(); return; }
      for (;;) {
        const end = buffer.indexOf('\n'); if (end < 0) break;
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try {
          const frame = JSON.parse(line), pending = this.pending.get(frame.id);
          if (!pending) continue;
          this.pending.delete(frame.id); clearTimeout(pending.timer);
          if (frame.error) pending.reject(new Error('Gateway access failed. Check the Hermes service, profile, and installation.'));
          else pending.resolve(frame.result);
        } catch { this.close(); return; }
      }
    });
    child.on('error', () => this.close()); child.stdin.on('error', () => this.close());
    child.on('close', () => { if (this.child === child) this.close(); });
    return child;
  }
  async access(profile: string, purpose?: 'interactive' | 'native-http'): Promise<{ endpoint: NativeEndpoint; ticket?: string }> {
    const result = await new Promise<unknown>((resolveResult, reject) => {
      const child = this.start(), id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Gateway discovery timed out. Check the Hermes service.')); }, 15000);
      this.pending.set(id, { resolve: resolveResult, reject, timer });
      child.stdin.write(JSON.stringify({ id, profile, purpose }) + '\n');
    });
    const value = z.object({ endpoint: endpointSchema, ticket: z.string().min(1).optional() }).parse(result);
    const root = await realpath(this.options.home);
    const home = await realpath(profile === 'default' ? root : resolve(root, 'profiles', profile));
    const origin = new URL(value.endpoint.api_origin);
    if (value.endpoint.profile_id !== home || (value.endpoint.control_home && ![home, root].includes(value.endpoint.control_home)) ||
        !['127.0.0.1', '[::1]'].includes(origin.hostname) || !['http:', 'https:'].includes(origin.protocol) ||
        origin.origin !== value.endpoint.api_origin || origin.username || origin.password || !origin.port ||
        !value.endpoint.capabilities.includes('session-authority-v1') || (purpose && !value.ticket))
      throw new Error('Gateway identity could not be verified. Check the configured Hermes profile.');
    return value;
  }
  close() {
    const child = this.child; this.child = undefined; child?.kill();
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Gateway discovery stopped. Retry the connection.')); }
    this.pending.clear();
  }
}
