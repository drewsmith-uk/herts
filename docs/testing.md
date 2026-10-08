# Testing and release checks

Use Node.js 24 or later, Python 3, and a clean checkout.
Install dependencies with `npm ci`.
Never point tests at production data or a real Hermes backend.

```sh
npm run check
npm run test:installer
npx playwright install --with-deps chromium
npm run test:browser
```

## Documentation checks

Use [ASD-STE100 Simplified Technical English](documentation-style.md) for all project documentation.
`npm run check:docs` checks Markdown prose, including new files.
`npm run test:docs` tests the checker with synthetic documents and a temporary repository.
Normal checks and release checks run both commands before the build.
Review approved vocabulary, grammar, and technical meaning separately.

## Test coverage

Unit and API tests cover these areas:

- New installations with only core Conversations, plugin discovery, and independent Notes activation.
- Migrations, receipt preservation, fixed package versions, failed migrations, and plugin disable, removal, restoration, and reset.
- Rejection of stale writes after reset, overdue reminders, task order, spaces, and snoozes.
- Reading duplicate detection, title edits, authenticated access, upload recovery, and uncertain action receipts.
- Profile selection, identity checks, reconnection, approvals, event replay, and notifications.

Installer tests use temporary paths and mocked systemd.
They check both modes, dry runs, repeated installation, conflicting files, occupied ports, named profiles, and quoting.

Browser tests start a temporary app and fake Hermes on ports 8790 and 8791.
They check phone and desktop layouts, dragging, accessible controls, offline synchronisation, conflicts, and shared reading conversations.
They also check recording recovery, message activity, history, notification navigation, update prompts, and existing browser storage.

Update tests use real service workers.
They cover offline changes, drafts, attachments, other open windows, failed installation, and failed storage.
They also cover voice drafts and accepted or unconfirmed Hermes submissions.

Plugin browser tests check core operation with Tasks and Reading disabled.
They also cover third-party installation, shared plugin actions, and reset while another device has offline edits.
Tests do not send production prompts or real push notifications.

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use a custom Chromium installation.
Otherwise, Playwright uses its normal browser location.
The full Chromium channel runs headlessly so service-worker push tests use the browser runtime.

Conversation settings tests cover staged changes, profile-scoped reads, sanitised responses, revision conflicts, default precedence, and busy-session refusal.
They also cover model confirmations, partial failures, and lost replies without duplicate writes or messages.
Browser fixtures check these controls on phones, desktops, Tasks, and Reading.
They cover offline reloads, defaults, and explicit Send actions.
The model catalogue and server folders contain synthetic data only.
These tests do not call your Hermes installation.

Security tests use synthetic deeply nested article HTML, malformed attachment references, malformed conversation links, and private fixture attachments.
They check worker deadlines, cancellation, API responsiveness, parser backoff, and compatibility with older Reading plugins.
They also check recovery with conversation controls available, deletion of server and browser copies, and upgrade cleanup.
Checks preserve protection against duplicate sends with uncertain outcomes.

## Release procedure

1. Run `npm run check:release` in a clean clone at a different filesystem path.
2. Verify that production-only dependency installation includes the `tsx` runtime that the service uses.
3. Review tracked and exported source. Exclude `.git` from fresh-history exports. Exclude ignored data, environment files, recordings, screenshots, traces, backups, and browser profiles.
4. Scan all Git refs with `gitleaks git . --log-opts=--all --redact=100`.
5. Scan built assets with `gitleaks dir dist --redact=100`. Also run `gitleaks dir plugins --redact=100` and `gitleaks dir examples --redact=100`.
6. Inspect flagged files without publishing their values. Keep only examples in `.env.example`.
7. Inspect personal identifiers, filenames, document metadata, test fixtures, and commit author metadata. A secret scanner does not replace a personal-data review.
8. Check `npm audit`, licence attribution, and the installation and upgrade instructions.
9. Review retained artifacts and logs before publication. Failed browser tests retain screenshots, error context, and traces for seven days. These files must contain only synthetic fixture data.
10. Make a private backup before an update. Preserve app origin, PWA identity, service-worker URL, storage keys, notification keys, and support for old requests.
11. Test an existing browser with pending edits, drafts, and an older service worker before you remove old static assets.
12. Restart only the app. Run the read-only connection check. Verify that the existing backend process remains alive.
13. Keep the old build and data backup for rollback.

Release checks build browser files in `.runtime/release-dist` and keep the served `dist` unchanged.
The Check and Quality workflows use pinned Actions revisions.
CI uses a scanner with a verified checksum and requires no live credentials.

## Repository publication

Before you change repository visibility, review all reachable remote Git refs and retained Actions logs, as well as source files.
Logs also become public.
Require a successful full CI run for the release commit.
Enable Dependabot alerts and review scheduled updates.

At publication, configure these settings:

- Enable private vulnerability reporting, secret scanning, and push protection.
- Require the Check workflow's `check` job and the Quality workflow's `verify` job on `main`.
- Block force-pushes and branch deletion.
- Require approval of workflows from outside contributors.

A free private repository might not support every setting.
Apply unavailable settings immediately after the visibility change.
Recheck each setting instead of assuming that private settings carry over.
Publishing source does not authorise public access to the running app.

## Licences and secrets

Builds generate licence notices from the actual browser and plugin inputs.
A build fails if a bundled dependency has no licence file.
Distribute `dist/THIRD_PARTY_NOTICES.txt` and each prepared package's notice file with the build.
Server dependencies installed through npm retain their own notices.

Secret scans reduce risk but cannot prove the absence of all secrets or private details.
If published content contains a real credential, revoke or rotate it.
Remove the exposure.
Deleting only the current file is insufficient.
