# Historical action archive

Herts retains complete historical actions in `archived_actions`.
Routine activity reads exclude these records.
Direct action lookup includes them.
Request receipts, action IDs, ordering, and notification identities remain unchanged.

## Eligibility

An action must meet all these conditions:

- Its state is `finished`, and its receipt is `accepted`.
- Its last change was at least 30 days ago.
- It is neither the current main action nor the latest Send.
- It has no saved recovery message or unresolved settings operation.
- No unresolved control depends on it.
- Its conversation has no pending recovery, dispatch, or active reconciliation.

The archive process checks eligibility again inside the move transaction.
Each batch examines at most 100 candidates.
The process waits between batches so that foreground requests can continue.

A late update restores the action inside a transaction.
The action retains its original position.
Deleted message content stays deleted.
Attachment references include active and archived actions.

## Switches and rollout

`HERTS_ARCHIVE_ACTIONS=0` disables automatic archival.
This is the default.
Set `HERTS_ARCHIVE_ACTIONS=1` to enable it.
Restart only the Herts app service after a configuration change.

The archive switch is independent of `HERTS_INCREMENTAL_SYNC`.
Disabling archival does not change the database schema or remove archived records.
The application continues to read archived records by ID.

Deploy recovery changes first, incremental sync second, and archival last.
Run `npm run check:release` for each stage.
Use isolated fixtures for validation.
Do not send live Hermes prompts for validation.

Before deployment, make a private database backup and retain the previous browser assets.
Check affected conversation controls on phone and desktop.
Compare recovery failures, notice creation, response sizes, foreground latency, and cache sizes.
A push provider acknowledgement does not confirm that the phone displayed the notification.

## Diagnostics and storage

`GET /api/v1/diagnostics/archive` reports the switch state, batch counts, moved counts, failures, and retention reasons.
These diagnostics exclude message content, credentials, and push endpoints.
The counters reset when the app service starts.

Archival reduces active data and routine traffic.
Total server storage continues to grow because the archive retains historical details.
