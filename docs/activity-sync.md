# Activity sync

Herts keeps conversation summaries separate from complete action records.
A summary contains action identities, status, receipt status, submission evidence, and recovery counts.
It does not contain message text, replies, attachments, or historical bindings.

## API

Read `/api/v1/activity-sync` to start a paged sync.
The default page contains up to 100 summaries.
The maximum page size is 200.
Pass the returned `cursor` to get the next page.
Continue while `hasMore` is true.

The cursor identifies a server generation and a position in the change log.
Each app startup creates a new generation.
This also applies after database restoration.
The change log retains at most seven days or 10,000 changes, whichever limit occurs first.

An expired cursor returns HTTP 409 with `rebase: true`.
A rebase replaces the summary set through pages, then reads changes made during that replacement.
Start again without a cursor.
Keep usable cached records until the replacement completes.

Use `/api/v1/state?actions=none` to omit complete action records.
Use `compact=1` on conversation activity and notification destination reads to request compact responses.
First-party reads can also send `X-Herts-Activity-Sync: 1`.
Requests without these options retain their existing response formats.
The SDK keeps summary types separate from `Action`.

Compact conversation responses include the current main action and latest send first.
They also include a page of recovery records and related controls.
Use the returned activity cursor to get more records.
An action change can invalidate this cursor.
In that case, read the first page again.

## Device storage

The browser saves each summary page and its cursor in one transaction.
It retains complete actions for the open conversation and 20 recent conversations.
Unresolved submissions and saved recovery messages remain available outside that limit.
Drafts, recordings, attachment ownership, deletion markers, and history caches have separate retention rules.

The cache migration preserves existing browser storage.
New cache tables prevent older tabs from restoring retired records through the legacy cache.
Recovered deletion records remove saved copies without removing independent drafts.

## Foreground reads

Cached conversation content is available before background sync completes.
Notification destinations, conversation activity, and history reads take priority over background pages.
Background paging resumes after foreground reads finish.

Send waits for the selected conversation's required edits, settings, title, and attachments.
It does not wait for unrelated queued edits.
An existing mutation request remains active until its response or timeout.
Concurrent callers share that request.

## Control

Incremental sync is enabled by default.
Set `HERTS_INCREMENTAL_SYNC=0` to disable the compact protocol.
Restart only the Herts app service after changing this setting.
The setting does not change the database schema or the Hermes backend.
