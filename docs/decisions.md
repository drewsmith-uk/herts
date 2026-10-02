# Behaviour and data ownership

Herts is a personal app with manual priorities and deliberate agent execution.

Headings, field labels and actions should explain the interface without a permanent tutorial. Supporting text is reserved for current status, errors, recovery and consequences that a control does not make clear. General behaviour, storage details and optional shortcuts belong in documentation. Show relevant advice at the point of need; for example, an excerpt warning belongs with an incomplete article, and update results appear after checking.

Conversations is always available. Tasks and Reading are optional plugins, enabled through **Settings → Plugins**. New installations start with Conversations only; existing installations retain both plugins and their data. Disabling or removing a plugin pauses its jobs and hides its screens and contributions, while retaining its data and core conversations. Reset is a separate, explicitly confirmed deletion. See [plugin lifecycle and data retention](plugins.md).

## Tasks and spaces

Each task space has Inbox, Next, Waiting, Parked, Snoozed and Done. Create and rename spaces from Settings or the **+** at the end of the space tabs. Tabs share available width on phones and scroll when they no longer fit. Conversations and Reading are global.

Delete empty added spaces from **Settings → Plugins → Tasks**, after confirmation. Done and Snoozed tasks also count as content; move them elsewhere first. Local capture drafts and saved dictation must be saved or cleared first. The original space remains as a renameable fallback, and becomes the default if the deleted space was the default. The server rechecks emptiness so concurrent task creation cannot be erased by a stale deletion.

Capture accepts a message, attachments or an optional title. Save to Inbox creates an unsent task in the selected space's Inbox, including when viewing another list. A task has no Hermes conversation until its first deliberate send. List order expresses priority. Moves normally put tasks at the top of the destination; Done is sorted by completion time and Snoozed by reminder time. Moving between spaces puts the same task in the destination Inbox, retaining its conversation and ongoing work. Settings selects the default space for conversation conversion and the voice shortcut.

Hold an item still to begin dragging. Drop it between items, onto another list, or onto a space tab (that space's Inbox). Edit list provides accessible reorder buttons and inline title editing. Otherwise edit titles on the detail page. Completing/reopening a task never stops Hermes or deletes history.

Snooze an Inbox task from its page or by swiping its row. At the chosen time the server returns it to Inbox and creates a reminder. The schedule is persisted and catches up after downtime. Moving/completing the task cancels its snooze. Notifications require browser permission and a working push subscription; delivery is not guaranteed at an exact instant.

## Conversations

New conversations use their first message as a starting title, unless a title was entered manually. A confirmed duplicate gets a numbered suffix on the same Hermes session; an uncertain response is never automatically retried. Conversation titles can be edited inline on the conversation page and save on blur. Existing-session renames use Hermes' metadata endpoint without resuming the conversation or sending a message; local task and reading titles remain separate.

Browse/search personal Hermes history before deciding what belongs in Tasks. Herts filters worker, test and internal conversations. There is no automatic backlog import. A conversation can become a new task; an unrelated existing task cannot be attached to it. Each task has at most one conversation and each conversation at most one task, including across spaces.

While Tasks is enabled, task-linked conversations are hidden from the general list by default, with an option to include them. Swipe a conversation right for an enabled plugin action or left to hide it. Multiple plugin actions open a chooser. Hidden status belongs only to Herts; Show hidden reveals it again. Accessible actions are on the conversation detail page, keeping list rows uncluttered.

Opening a conversation reads available history and observes status; it never resumes work. Sending a message prepares/resumes the same conversation when necessary, then submits the message. Existing settings follow Hermes's resume behaviour unless you have explicitly staged changes in Herts. There is no separate Continue button.

The conversation detail page, task page and reading item page use the same conversation panel. You can reply directly from Conversations without creating either kind of item. Opening an individual conversation saves its reference in Herts; listing/searching does not import references for the backlog. This reference does not count as a task link or hide the conversation. If you later create a task or bookmark a link, it reuses the same reference, device draft, submissions and execution controls. Notifications for a conversation without either item open its conversation page.

History starts at its most recent messages, with the detail header initially visible. Adjacent tool-only rounds are grouped under one expandable activity section. Expanding preserves the top of that section so it is easy to collapse. Available original message times are displayed; missing timestamps are not invented. Compaction/session rotation can limit older history.

## Conversation settings

The shared composer offers model/provider, reasoning effort, fast mode and a Hermes-server working folder. Models and capabilities come from Hermes's configured catalogue; current values come from the verified live session when available, otherwise saved session metadata. Missing values are labelled unknown rather than replaced with a guessed model or profile default. Hermes can map effort levels for a provider; a reported wire effort is shown separately.

One settings button shows the model and effort and opens the conversation settings dialog. Each inherited field identifies its source: Hermes default (profile), Herts default (new-conversation override), or current session setting (an existing conversation). After Send, applied choices belong to that session, regardless of whether they match a default. Pending changes are labelled “Applies on next Send”.

Changing a control only stages metadata in Herts. It does not create/resume a conversation, submit a prompt or alter Hermes configuration. The next Send prepares the session, confirms it is idle, applies the staged settings through Desktop-compatible session controls, confirms the changes, then submits the saved message. Choices persist for later messages. A recovered active turn must finish or be stopped before pending settings can be applied. No slash commands or synthetic instruction messages are sent.

General Settings stores new-conversation defaults across devices. On the first Send, per-conversation choices override Herts defaults, which override the Hermes profile defaults. This applies to new Conversations and plugin-created conversations, including Tasks and Reading. Imported/existing conversations retain their own settings. No Herts control writes Hermes profile defaults. Plugins embedding the core conversation panel get the same controls automatically.

Pending choices survive reloads and offline use. Settings have revisions; concurrent edits require review. Hermes model-switch confirmations retain the unsent message and require explicit acceptance. Failed or uncertain changes leave the message saved, distinguish confirmed partial changes, and never silently repeat an uncertain setter. A later deliberate Send can reconcile an already-applied choice; otherwise the user must refresh and explicitly review the choices before retrying. Settings are not a multi-field transaction: some fields can apply before a later field fails.

## Reading

Reading items are separate from tasks. Adding or sharing a URL opens a reviewable message draft. Save link creates an unsent reading item; Send creates the item and submits the reviewed message to Hermes. Bookmark a link in an existing conversation to create a reading item without another agent message. The selected link is its reading target; the same conversation may have several different reading links, but the same conversation/link pair is deduplicated. A bookmark already saved opens its existing reading item.

A reading association does not count as a task link and does not hide the conversation from browsing. A reading conversation can still become a task. Both views continue the same conversation and share execution controls. Marking a reading item read is independent of task completion.

Open the original link, use the in-app article reader, or open the system browser. Arbitrary sites may refuse embedding; a readable article is extracted and sanitised where possible. Extraction may only provide an excerpt and does not bypass login/paywalls. Unread articles can download automatically; copies are removed after marking read, including on other devices when they next sync. Herts restricts article fetches to public HTTP(S) addresses with redirect/DNS checks.

## Execution, recovery and privacy

Task changes, viewing history, bookmarking existing links and completing items never invoke an agent. Sending, answering an approval/clarification, and requesting a stop are explicit actions. A stop is a request, not a guarantee of rollback. Accepted work can continue when the browser closes because the server keeps the Hermes connection independently.

Server SQLite stores task/space/reading data, conversation links, uploads, action receipts, notifications and article copies. Browser IndexedDB stores offline edits, drafts, recordings, attachments, viewed history and article copies. The server is authoritative across devices; conflicts are surfaced rather than silently overwriting a concurrent edit.

Submitted messages have durable IDs/receipts. If acceptance cannot be confirmed, Herts retains the submission and distinguishes uncertainty from rejection. It does not automatically repeat an uncertain agent action. Browser drafts are not server backups. Device security protects cached data; clearing browser storage loses unsynced work.

Deleting a saved message removes its text and attachment references from Herts, and removes attachment files that no other message needs. Other devices clear their cached saved copies when they reconnect. A draft deliberately copied from the message remains a separate draft. Herts retains operation IDs, status and server-only fingerprints to prevent duplicate sends; deleting a saved copy does not delete Hermes history or older backups. On upgrade, Herts also clears content previously marked as deleted.

Microphone capture and read-aloud are explicit. Dictation appends to the shared editable message draft for review. Messages are sent only by pressing Send; there is no countdown or automatic sending. Read-aloud applies to backend assistant responses, with playback controls. Audio is processed through the selected Hermes profile; OS/browser dictation is not substituted.

Production access requires the configured Tailscale user and app origin. Secrets stay on the server. Notifications intentionally include task titles. Herts supports one user per deployment; spaces are organisational groups, not security boundaries. The backend token may grant broad access to Hermes, so keep it private and bind the backend to loopback or protect its HTTPS endpoint.
