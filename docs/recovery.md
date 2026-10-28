# Connection recovery

Herts recovers execution updates without an open browser.
Recovery never submits prompts or repeats user decisions.

Standalone recovery keeps its checkpoint until missed events are processed.
Live events wait in a bounded buffer during recovery.
Buffer overflow causes another replay read.
Missing or truncated replay does not prove successful completion.

Gateway recovery uses session snapshots and admission receipts.
Obsolete snapshot responses cannot replace newer session state.
Confirmed earlier admissions can produce completion notifications after a newer submission exists.

Recovery retries after 1, 2, 4, 8, 16, and 30 seconds.
Further retries use 30-second delays while connected.
At most four session recoveries run concurrently.
Active work has priority over idle sessions.

The authenticated `/api/v1/diagnostics/recovery` endpoint returns aggregate recovery counters.
Attempt, failure, completion, and overflow counters restart with the app service.
The pending count comes from saved bindings.
The notice count comes from saved notification records.
These counters contain no message content or push credentials.

Notification records and recovered state are saved before delivery starts.
Existing delivery receipts prevent repeated recovery from creating duplicate notifications.
Push-provider acceptance does not confirm that the phone displayed a notification.
