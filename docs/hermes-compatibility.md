# Hermes backend compatibility

Herts uses the Desktop-compatible HTTP and JSON-RPC/WebSocket gateway provided by `hermes serve`. It does not scrape the Desktop UI or read Hermes's SQLite files directly.

The integration was reviewed against Hermes Agent 0.21.2 source at upstream commit `5eb99eb2844b22ebb723711b8e6a0bbb80bb5f04`. The deployed default-profile backend was checked independently with read-only status/session queries. The source version is not a claim that an already-running backend has reloaded that exact commit. Named-profile behaviour is covered by isolated fixtures and the profile-scoped upstream API contract; it must be checked against the actual backend you select.

Primary references: [Hermes documentation](https://hermes-agent.nousresearch.com/docs/), [dashboard and backend](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard), and [Hermes source](https://github.com/NousResearch/hermes-agent).

## Required capabilities

- Token authentication via `X-Hermes-Session-Token` for HTTP and the Desktop token query parameter for `/api/ws`.
- Profile-scoped session listing, search, owned-session lookup, and paginated messages with profile identity and compaction/lineage information.
- `gateway.ready` with a replay epoch, `gateway.ping`, and sequenced session events/replay.
- `session.create`, `session.resume`, `session.activate`, `session.events.since`, `session.control.read`, `prompt.submit`, `approval.pending`, `approval.respond`, `clarify.respond`, `session.interrupt` and file attachment RPCs.
- Session creation that survives client disconnect (`close_on_disconnect: false`). Resuming must preserve the underlying stored conversation/context.
- For media/voice: profile-scoped attachment reads, transcription and speech endpoints. The necessary audio providers must be configured in Hermes.

Managed installation additionally requires `hermes serve --isolated` to avoid a named-profile launch attaching to an unrelated machine-level server. Herts does not upgrade Hermes or configure its model providers.

The configured `HERMES_PROFILE` is passed through history, search, create/resume, media and audio requests. Returned profile stamps are verified where supplied, and creation/history require identity confirmation. Warm Desktop sessions can omit a redundant profile stamp; runtime session identity, lineage and replay epoch are still checked. A mismatched identity prevents submission.

Continuing an existing conversation retains its settings through Hermes's resume flow unless a change has been staged in Herts. New conversations inherit the selected profile's configuration, with optional Herts defaults and per-conversation overrides. Herts does not guarantee that older settings survive every upstream compaction or version change beyond what Desktop itself preserves.

## Interactive prompt compatibility

Herts negotiates `client.capabilities {server_requests:true}` after every `gateway.ready`, before allowing session work. A confirmed `-32601` (method not found) selects the older event protocol; a timeout, permission error or malformed capability reply does not silently select it. The connection check reports the negotiated protocol, and Settings explains a failed handshake. Session metadata reporting a newer Desktop contract than the tested contract 8 produces an update warning.

The current request protocol was checked against installed Hermes source `ba5e3bfa31`, Desktop contract 8. Herts handles `approval` and `clarify` JSON-RPC requests, restores `open_requests` from session/replay snapshots, and removes prompts on `request.cancel`. Single questions, choices, multiple-choice questions and batches use the shared conversation controls. Confirmed answers from another client remain locked. Approval choices remain **Approve once** and **Deny**, restricted to choices advertised by Hermes.

Responses use Hermes's acknowledged `request.answer` proxy with the original request ID. If an earlier request-protocol backend explicitly lacks that method, approvals use the acknowledged `approval.respond` queue; clarification uses a single response frame and is labelled unconfirmed because a socket write alone cannot prove receipt. Lost acknowledgements are retained as uncertain and never automatically resent. Request IDs, session bindings and durable decision receipts prevent duplicate or stale consent.

Other interactive request types (including password/secret entry and Desktop-only controls) receive an explicit unsupported-method error and a visible explanation in the conversation. Herts does not collect those secrets or substitute approval. Requests already withdrawn by Hermes cannot be restored; retrying the original work remains a deliberate user action.

`preview.read` is a Desktop browser-pane tool request, not a consent prompt. Herts has no corresponding preview bridge and does not show an approval/update warning for it. When Hermes advertises `declines_not_shown`, Herts sends the Desktop-compatible `4404` decline so another attached Desktop window can still answer; if all clients decline, Hermes supplies the unavailable-preview explanation. Earlier backends receive a `ValueResult` containing a failed tool result and a clear explanation that preview reading is unavailable in Herts (plain JSON-RPC error text would be discarded before reaching the agent). Herts does not read a page or approve work in either case. Previously saved warnings mislabelling `preview.read` as an approval prompt are cleared on startup; other warnings and decision receipts are retained.

Older backends keep their `approval.request` / `approval.pending` / `approval.respond` and `pending_clarify` / `clarify.respond` paths. Opening a conversation or negotiating capabilities never starts agent work.

## Session settings controls

The session settings contract was also checked against Hermes Agent 0.21.3 source at `2ed6387d87b4db091af2f05db32faab6e0dbb9a2`, and catalogue/default reads were verified against the running backend without agent work.

The optional controls require `model.options` with configured provider/model capabilities, `config.get` (reasoning, fast, project), profile-stamped `GET /api/sessions/:id` metadata and directory browsing through `GET /api/files`. Only model/provider, effort, speed and folder fields are returned to the browser; raw model configuration and provider credentials are never forwarded.

At the next Send, Herts uses `session.create` overrides for a new conversation or confirmed idle-session controls: `config.set model` with explicit provider and `--session`, `config.set reasoning` with session scope, `config.set fast`, and `session.cwd.set`. It never uses the profile-wide cwd setter. Every write targets the verified runtime; unknown/deferred outcomes stop before prompt submission. The backend must preserve these session overrides on subsequent turns and resume, as Desktop expects. Missing catalogue/capability information is reported; existing messaging without pending changes remains available. An unavailable selected model or folder blocks the message and retains it for review.

## Validate your installation

Run the read-only check with the same environment file as the app:

```sh
node --env-file=data/app.env --import tsx scripts/check-connection.ts
```

This checks authenticated app access, profile-scoped session metadata and gateway readiness/ping without printing conversation data. It does not exercise every execution/audio capability, and an empty session list cannot prove a backend's profile isolation. Before relying on an unfamiliar backend version, deliberately send a harmless message in a new test conversation and verify its profile/settings in Hermes. Such a send is a user action, never part of installation, CI or the automatic connection check.

If the backend is unavailable, task/space/snooze/reading metadata remain usable. Conversation history and agent/audio features require reconnection; messages with uncertain outcomes must be reviewed, not automatically resent.

If a session disappears before any message was submitted from Herts, the next deliberate Send can recover in the same Herts conversation. This includes older failed setups without a creation record: Herts requires an existing runtime binding and saved attempts proving that every message stopped before submission. It refreshes conversation aliases and requires both a profile-scoped stored-session 404 and a confirmed missing runtime before replacing the link. The Herts context, reading/task references, saved messages and submission receipts remain intact. Active, accepted or uncertain prompt submissions, conversation lineage changes, and unavailable verification block replacement. Recovery retains the new-conversation defaults revision from Send; if those defaults change before the replacement is prepared, the message stays saved and the existing link is retained for review. Merely opening the conversation or reconnecting does not create a session or resend a message. There is no separate repair step; the earlier reconnect endpoint remains available only for compatibility with older installed clients.
