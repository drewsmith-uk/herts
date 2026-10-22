# Hermes backend compatibility

## Connection modes

Standalone mode remains the default and uses the configured `hermes serve` endpoint.
Gateway mode uses the local shared Hermes service through `hermes-gateway-v1`.
It uses authenticated discovery, temporary tickets, and explicit profile ownership checks.
The adapter retains the existing Herts conversation controls and plugin interfaces.

Gateway submissions have durable submission IDs and admission receipts.
Herts saves submission IDs before dispatch and uses receipts to check outcomes after reconnecting.
A matching pending submission can recover a lost acknowledgement.
Matching message text alone cannot establish acceptance.
An unknown outcome remains unknown when Hermes supplies no matching receipt.
Herts never repeats message submission during reconnection.

Gateway event replay uses each session's replay epoch, sequence, and execution generation.
A replay gap requires a fresh snapshot.
Herts checks the saved admission receipt before reporting completion.
Events from another client's admission cannot complete the saved Herts action.
Approvals and questions use generation checks and acknowledged responses.

Gateway model, reasoning, workspace, and title changes use revision-fenced mutations.
Deferred settings and unknown outcomes prevent message submission.
Current settings also use the canonical `session.info` read.
The standalone protocol details below apply only to standalone mode.

## Protected title changes

Current Hermes releases require a request ID and a session revision for title changes.
Herts reads the mutation snapshot before it checks the current title.
It saves the request before submission and verifies the returned revision and session identity.
After an unknown outcome, Herts checks the current title without repeating the write.
A conflicting edit requires a refresh and review.
The connection check verifies revision reads but does not test writes.

Messages blocked before sending remain saved after an update.
Follow the [message recovery steps](../README.md#recover-a-message-that-was-not-sent) to send them manually.

Herts uses the Desktop-compatible HTTP and JSON-RPC/WebSocket gateway provided by `hermes serve`. It does not scrape the Desktop UI or read Hermes's SQLite files directly.

The compatibility update was checked against Hermes v0.22.4, commit `4d04303818b61bf3aa09278af48356315515965b`.
It was also checked against installed source `944c3a434071f43e64b443d033f3eba30c64434c`.
Isolated checks covered both connection modes, profiles, Bot Chat, history, protected renaming, and routine changes.
Gateway checks also covered reasoning, workspace, speed, attachment staging, and idle controls.
No model prompts were submitted.
Synthetic tests covered admissions, lost acknowledgements, prompt responses, replay, and ownership checks.
These checks do not verify live model providers or audio providers.
An installed source version does not prove that an existing backend process uses that version.

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

Herts negotiates `client.capabilities {server_requests:true}` after every `gateway.ready`, before allowing session work. A confirmed `-32601` (method not found) selects the older event protocol. A timeout, permission error, or malformed capability reply does not silently select it. The connection check reports the negotiated protocol, and Settings explains a failed handshake. Session metadata reporting a newer Desktop contract than the tested contract 8 produces an update warning.

The current request protocol was checked against installed Hermes source `ba5e3bfa31`, Desktop contract 8. Herts handles `approval` and `clarify` JSON-RPC requests, restores `open_requests` from session/replay snapshots, and removes prompts on `request.cancel`. Single questions, choices, multiple-choice questions and batches use the shared conversation controls. Confirmed answers from another client remain locked. Approval choices remain **Approve once** and **Deny**, restricted to choices advertised by Hermes.

Responses use Hermes's acknowledged `request.answer` proxy with the original request ID. An earlier request-protocol backend can report that it lacks this method. In that case, approvals use the acknowledged `approval.respond` queue. Clarification uses one response frame and remains unconfirmed. A socket write alone cannot prove receipt. Lost acknowledgements are retained as uncertain and never automatically resent. Request IDs, session bindings and durable decision receipts prevent duplicate or stale consent.

Other interactive request types receive an explicit unsupported-method error and an explanation in the conversation. These include password entry, secret entry, and Desktop-only controls. Herts does not collect those secrets or substitute approval. Requests already withdrawn by Hermes cannot be restored; retrying the original work remains a deliberate user action.

`preview.read` is a Desktop browser-pane tool request, not a consent prompt. Herts has no corresponding preview bridge and does not show an approval/update warning for it. When Hermes advertises `declines_not_shown`, Herts sends the Desktop-compatible `4404` decline. Another attached Desktop window can still answer. If all clients decline, Hermes supplies the unavailable-preview explanation. Earlier backends receive a `ValueResult` with a failed tool result. This result explains that preview reading is unavailable in Herts. Plain JSON-RPC error text would not reach the agent. Herts does not read a page or approve work in either case. Previously saved warnings mislabelling `preview.read` as an approval prompt are cleared on startup; other warnings and decision receipts are retained.

Older backends keep their `approval.request` / `approval.pending` / `approval.respond` and `pending_clarify` / `clarify.respond` paths. Opening a conversation or negotiating capabilities never starts agent work.

## Session settings controls

The session settings contract was checked against Hermes Agent 0.21.3 source at `2ed6387d87b4db091af2f05db32faab6e0dbb9a2`. Catalogue and default reads were verified against the running backend without agent work.

The optional controls require `model.options` with configured provider/model capabilities and `config.get` (reasoning, fast, project). They also require profile-stamped `GET /api/sessions/:id` metadata and directory browsing through `GET /api/files`. Herts returns only model/provider, effort, speed, and folder fields to the browser. It never forwards raw model configuration or provider credentials.

Standalone mode provides `session.info` events but does not provide a `session.info` request.
Herts uses that request only in gateway mode.

Herts reads current stored settings through the existing session detail HTTP endpoint.
Missing effort uses profile configuration from `GET /api/config` with `include_defaults=false`.
Saved session effort takes precedence over model-specific and profile defaults.
Confirmed live events take precedence over stored metadata.
These reads do not attach a viewer or start an agent.
No Hermes source changes are required.
Successful reads clear **Last saved** when all settings are current.
Cached or incomplete values retain their source labels.

At the next Send, Herts uses `session.create` overrides for a new conversation or confirmed idle-session controls: `config.set model` with explicit provider and `--session`, `config.set reasoning` with session scope, `config.set fast`, and `session.cwd.set`. It never uses the profile-wide cwd setter. Every write targets the verified runtime; unknown/deferred outcomes stop before prompt submission. The backend must preserve these session overrides on subsequent turns and resume, as Desktop expects. Missing catalogue/capability information is reported; existing messaging without pending changes remains available. An unavailable selected model or folder blocks the message and retains it for review.

## Validate your installation

Run the read-only check with the same environment file as the app:

```sh
node --env-file=data/app.env --import tsx scripts/check-connection.ts
```

This checks authenticated app access, session metadata, settings refresh, and gateway readiness without printing conversation data. It does not exercise every execution/audio capability, and an empty session list cannot prove a backend's profile isolation. Before you use an unfamiliar backend version, send a harmless message in a new test conversation. Verify its profile and settings in Hermes. Such a send is a user action, never part of installation, CI or the automatic connection check.

If the backend is unavailable, task/space/snooze/reading metadata remain usable. Conversation history and agent/audio features require reconnection; messages with uncertain outcomes must be reviewed, not automatically resent.

A session can disappear before Herts submits a message. The next deliberate Send can then recover within the same Herts conversation. This includes older failed setups without a creation record: Herts requires an existing runtime binding and saved attempts proving that every message stopped before submission. It refreshes conversation aliases and requires both a profile-scoped stored-session 404 and a confirmed missing runtime before replacing the link. The Herts context, reading/task references, saved messages and submission receipts remain intact. Active, accepted or uncertain prompt submissions, conversation lineage changes, and unavailable verification block replacement. Recovery keeps the new-conversation defaults revision from Send. Those defaults can change before Herts prepares the replacement. In that case, the message stays saved and the existing link remains available for review. Merely opening the conversation or reconnecting does not create a session or resend a message. There is no separate repair step; the earlier reconnect endpoint remains available only for compatibility with older installed clients.

## Bots

The isolated API smoke check passed against Hermes source `569fd58960b93040b333cf744c8f2adc152f71bd`: profile creation/configuration, canonical chat materialisation, profile-scoped history, timezone and routine CRUD, without model prompts.

Bots additionally uses `profiles.list`, `profiles.describe`, `profiles.create`, `profiles.configure` with `ui_meta_expected_revisions`, and `profiles.get_asset`. Permanent-chat lookup uses `session.list` with exact `title: "Bot Chat"` and `include_hidden: true`; creation requires `session.title` to materialise the row and uses `follow_profile_config: true`. Backend-owned compaction lineage remains the identity source.

Routine management uses profile-stamped `GET /api/cron/jobs`, creation, `PUT /api/cron/jobs/:id`, pause/resume/trigger/delete endpoints, and run history. Every item mutation first verifies membership in the selected profile. Hermes item routes can search other profiles when a hint does not contain the job. `GET /api/config` supplies only the scheduling timezone to the browser. Routine transcripts are read only after verifying their membership in that routine’s run history.

Profile routing tests use identical stored-session IDs across profiles.
Existing records retain their configured profile, conversation IDs, drafts, and receipts.
Database version 8 stores gateway identities and receipts in existing JSON records.
Rollback requires the matching backup described in [Backups and upgrades](maintenance.md).

Run the opt-in isolated source check with `node --import tsx scripts/check-bots-source.ts /path/to/hermes-agent`. It creates a temporary Hermes home and loopback server. It checks profile metadata, an empty canonical chat, and a routine scheduled far in the future. It removes them after the checks. It never submits model prompts or uses production profiles.

Add `--gateway` to check shared gateway mode against the same source.
Set `HERTS_TEST_PYTHON` to use an existing Hermes interpreter with an exported source tree.
