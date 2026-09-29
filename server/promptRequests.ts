import { z } from 'zod';

const id = z.string().min(1).max(200);
const previewRead = z.object({ id, method: z.literal('preview.read'), params: z.object({ session_id: id, start: z.number().int().nullish(), count: z.number().int().nullish() }) });
export const previewUnavailable = 'Herts does not support reading the Hermes Desktop browser preview. No preview content was read. Use another available tool, or ask the user to share the page text or a screenshot.';
export const obsoletePreviewWarning = 'Herts cannot display the Hermes “preview.read” prompt. Update Herts or use a compatible Hermes client. No approval was given.';
const question = z.object({ qid: id, question: z.string(), choices: z.array(z.string()).nullish(), multi_select: z.boolean().optional() });
const frame = z.discriminatedUnion('method', [
  z.object({ id, method: z.literal('approval'), params: z.object({ session_id: id, request_id: id, command: z.string().optional(), description: z.string().optional(), choices: z.array(z.enum(['once', 'session', 'always', 'deny'])).optional() }) }),
  z.object({ id, method: z.literal('clarify'), params: z.object({ session_id: id, question: z.string().nullish(), choices: z.array(z.string()).nullish(), multi_select: z.boolean().nullish(), questions: z.array(question).max(100).nullish(), answers: z.record(z.string(), z.string()).nullish() }).refine(p => !!p.question || !!p.questions?.length).refine(p => !p.questions || new Set(p.questions.map(q => q.qid)).size === p.questions.length) }),
]);
export type PromptRequest = z.infer<typeof frame>;

/** Connection-local prompts. Durable consent and uncertain receipts live in Actions. */
export class PromptRequests {
  version = 0;
  private rows = new Map<string, { request: PromptRequest; version: number }>();
  private closed = new Set<string>();
  private problems = new Map<string, string>();
  constructor(private changed: (session: string) => void, private reject: (id: string, code: number, message: string) => void, private declinePreview = (id: string) => reject(id, -32601, previewUnavailable)) {}
  reset() { this.rows.clear(); this.closed.clear(); this.problems.clear(); this.version++; }
  list(session: string) { return [...this.rows.values()].map(row => row.request).filter(r => r.params.session_id === session); }
  warning(session: string) { return this.problems.get(session); }
  clearWarning(session: string) { if (this.problems.delete(session)) this.changed(session); }
  receive(value: any, session?: string) {
    if (typeof value?.id !== 'string' || this.closed.has(value.id)) return;
    const preview = previewRead.safeParse(value);
    if (preview.success && (!session || preview.data.params.session_id === session) && !this.rows.has(value.id)) {
      // A Desktop pane read is a tool capability request, never a consent prompt.
      // Keep unrelated warnings and pending approvals/questions intact.
      this.close(value.id);
      this.declinePreview(value.id);
      return;
    }
    const parsed = frame.safeParse(value);
    if (!parsed.success || (session && parsed.data.params.session_id !== session)) {
      const sid = session || value?.params?.session_id;
      const unsupported = !['approval', 'clarify'].includes(value?.method);
      const method = typeof value?.method === 'string' && /^[\w.]{1,100}$/.test(value.method) ? value.method : 'unknown';
      const message = unsupported ? `Herts cannot display the Hermes “${method}” prompt. Update Herts or use a compatible Hermes client. No approval was given.` : 'Hermes sent an incompatible prompt. Update Herts or use a compatible Hermes client. No approval was given.';
      this.close(value.id);
      this.reject(value.id, unsupported ? -32601 : -32602, unsupported ? 'Prompt method not supported by Herts' : 'Invalid prompt parameters');
      if (typeof sid === 'string') { this.problems.set(sid, message); this.changed(sid); }
      return;
    }
    const request = parsed.data, prior = this.rows.get(request.id);
    if (prior) {
      const immutable = (r: PromptRequest) => JSON.stringify({ ...r, params: { ...r.params, answers: undefined } });
      if (immutable(prior.request) !== immutable(request)) {
        this.close(request.id);
        this.reject(request.id, -32602, 'An existing prompt changed identity or content');
        this.problems.set(request.params.session_id, 'Hermes changed a pending prompt unexpectedly. No approval was given. Refresh the conversation before continuing.');
        this.changed(request.params.session_id); return;
      }
      if (request.method === 'clarify' && prior.request.method === 'clarify') request.params.answers = { ...prior.request.params.answers, ...request.params.answers };
    }
    if (JSON.stringify(prior?.request) === JSON.stringify(request)) return;
    this.rows.set(request.id, { request, version: ++this.version });
    this.changed(request.params.session_id);
  }
  close(id: string, session?: string) {
    const prior = this.rows.get(id);
    if (session && prior && prior.request.params.session_id !== session) return;
    this.closed.add(id);
    if (this.closed.size > 2000) this.closed.delete(this.closed.values().next().value!);
    this.rows.delete(id); this.version++;
    if (prior) this.changed(prior.request.params.session_id);
  }
  restore(session: string, values: unknown[], startedAt: number) {
    const ids = new Set(values.map((r: any) => r?.id));
    // A snapshot read started before a new prompt/cancellation must not undo that event.
    for (const [key, row] of this.rows) if (row.request.params.session_id === session && row.version <= startedAt && !ids.has(key)) this.close(key);
    for (const value of values) {
      const row = this.rows.get((value as any)?.id);
      if (!row || row.version <= startedAt) this.receive(value, session);
    }
  }
}
