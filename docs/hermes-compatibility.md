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

Continuing an existing conversation does not send a replacement model or project folder. Hermes's resume flow resolves those settings. Starting a new conversation uses the selected profile's configuration. Herts does not guarantee that older settings survive every upstream compaction or version change beyond what Desktop itself preserves.

## Validate your installation

Run the read-only check with the same environment file as the app:

```sh
node --env-file=data/app.env --import tsx scripts/check-connection.ts
```

This checks authenticated app access, profile-scoped session metadata and gateway readiness/ping without printing conversation data. It does not exercise every execution/audio capability, and an empty session list cannot prove a backend's profile isolation. Before relying on an unfamiliar backend version, deliberately send a harmless message in a new test conversation and verify its profile/settings in Hermes. Such a send is a user action, never part of installation, CI or the automatic connection check.

If the backend is unavailable, task/space/snooze/reading metadata remain usable. Conversation history and agent/audio features require reconnection; messages with uncertain outcomes must be reviewed, not automatically resent.
