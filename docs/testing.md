# Testing and release checks

Use Node.js 24.22.1 or a later stable Node.js 24 release.
Use Python 3 and a clean checkout.
CI selects the version in `.node-version`.
The package requirements and installer must accept the same stable Node.js 24 releases.
Run `npm run check:runtime` to check the active executable.
Run `npm run test:runtime` and `npm run test:installer` after runtime requirement changes.
Install dependencies with `npm ci`.
The project rejects unsupported runtime versions during installation.
Never point tests at production data or a real Hermes backend.

```sh
npm run check
npm run test:installer
npx playwright install --with-deps chromium
npm run test:browser
```

## Design checks

Run `npm run check:design` to validate the design format, token references, contrast, and generated files.
Run `npm run design:generate` only after an approved design change.
Build and release checks reject stale generated files.
The validator version is pinned in package.json.
Border tokens can produce unused-component warnings because the standard component schema has no border properties.
The generator uses these tokens through semantic CSS variables.

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
The Quality workflow uses pinned Actions revisions.
It runs release checks once on each pull request update and each push to `main` or `master`.
A newer update cancels the previous run for that pull request or branch.
The `prepare` job builds the app and runs documentation, design, type, unit, API, and installer checks.
It also scans repository history and built files for secrets.
Two browser jobs download the same build and run separate groups of complete spec files.
Each spec starts a fresh synthetic server.
The `verify` job requires preparation and both browser groups to succeed.
The `check` job reports the `verify` result without repeating tests.
Both job names remain available for existing branch protection rules.
CI uses a scanner with a verified checksum and requires no live credentials.

## Repository publication

Before you change repository visibility, review all reachable remote Git refs and retained Actions logs, as well as source files.
Logs also become public.
Require a successful full CI run for the release commit.
Enable Dependabot alerts and review scheduled updates.

At publication, configure these settings:

- Enable private vulnerability reporting, secret scanning, and push protection.
- Require the Quality workflow's `check` and `verify` jobs on `main`.
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


## Development environment

Use a separate data directory for interactive development:

```sh
HERTS_DEV=1 HERTS_DATA_DIR=.runtime/dev-data npm run dev:server
# In another terminal:
npm run dev
```

Open `http://127.0.0.1:5173`.
If inherited environment variables configure Hermes, unset them for tasks-only development.
Never use production data in development mode.

## Test selection policy

Choose checks from the changed behavior, affected components, and possible data loss.
Do not run the full release suite for every small update.

| Change | Required checks |
| --- | --- |
| Documentation only | Run `npm run check:docs`. Review meaning and technical terms. |
| Small UI or plugin correction | Build the affected package. Run type checks for TypeScript changes. Run relevant workflow tests. |
| Editable controls | Also check draft preservation, submission, offline use, and recovery where affected. |
| New screen or substantial screen change | Apply the complete UI criteria in [AGENTS.md](../AGENTS.md). |
| Shared behavior across multiple workflows | Run `npm run check:release`. |
| Storage, migrations, authentication, remote actions, dependencies, or plugin runtime | Run `npm run check:release`. |
| Grouped or scheduled release | Run `npm run check:release`. |

For small UI corrections, inspect narrow and wide screenshots and check the affected controls.
Check additional themes when theme styles or shared layout rules change.
Use existing tests when they already cover the behavior.
Add regression tests for new failure cases or changed behavior with data preservation requirements.
Do not add tests that only repeat the implementation.

Select relevant UI tests instead of running every UI test:

```sh
HERTS_TEST_DIST_DIR=.runtime/release-dist npm run test:ui -- --grep 'refined capture'
```

Build the current browser code into the selected directory before testing browser changes.
For plugin-only changes, build the plugin and test it against the compatible browser bundle.
Small installed updates may proceed after their selected checks pass.
They do not require a full release run or the complete theme and viewport matrix.

Reuse successful results for unchanged code and dependencies.
Do not repeat broad checks after a passing focused check without a specific reason.
Investigate unrelated failures separately and report them.
Resolve affected failures before deployment.
State completed checks, omitted checks, and remaining limits.

The Quality workflow keeps the full integration checks on pull requests and main-branch pushes.
Local updates use this selection policy without repeating unrelated CI checks.

## Staged browser builds

`npm run check:release` checks documentation and types, then builds browser files in `.runtime/release-dist`.
It runs unit, API, installer, and browser tests without replacing the served `dist`.
Each browser spec uses a fresh fixture to prevent shared conversations, downloads, or pending work from affecting other specs.

`npm run test:ui` runs the focused plugin and UI tests against an existing build.
Set `HERTS_TEST_DIST_DIR` to test a staged build.
Follow the UI completion criteria in [AGENTS.md](../AGENTS.md).

For deployment, follow [Backups and upgrades](maintenance.md).
Keep earlier hashed assets when you deploy the tested browser output.
Restart the Herts app service if server code changed.
Apply any plugin package update separately.

Test traces and screenshots stay in ignored local directories.
CI retains failed browser diagnostics with synthetic data for seven days.


### Parallel CI browser checks

Local `npm run check:release` runs all checks in sequence.
CI builds once and transfers the staged browser files, generated plugin files, and licence notices to two isolated runners.
The transferred files include the Notes example.
Each runner has its own ports, data, and output directories.
Each spec uses one worker and a fresh server.
The workflow does not cancel the other group when one group fails.

Use these commands to select a release phase:

```sh
npm run check:release -- --phase=prepare
npm run check:release -- --phase=browser --shard=1/2
npm run check:release -- --phase=browser --shard=2/2
node scripts/check-release.mjs --phase=browser --shard=1/2 --list
```

Browser phases require the prepared build and generated plugin files.
The list command does not require a build.
Run groups on separate machines because browser fixtures use fixed ports.

`scripts/browser-timings.json` records durations from [Quality #94](https://github.com/drewsmith-uk/herts/actions/runs/39238144162).
The runner first assigns specs with longer durations to the group with the lowest estimated duration.
Alphabetical order resolves equal spec durations.
New specs use the median recorded duration and enter a group automatically.
The runner preserves the release spec order within each group.
Timing estimates control assignment only.
They do not control test selection, timeouts, or assertions.

Each group writes elapsed times and results to `test-results/release-timings-<group>/timings.json`.
Separate Playwright JSON reports record test identities and results for each spec.
Reports include completed specs and the failing spec when execution stops.
CI retains timing reports and failed browser diagnostics for seven days.
Timing and failure artifacts have separate names for each group and run attempt.
The build artifact expires after one day.
Use `npm run test:release-runner` to check grouping, missing outputs, failure reports, and required workflow dependencies.

Compare the serial test inventory with both group inventories before accepting a timing improvement.
Run both groups twice on the same commit to check repeatability.
Compare elapsed time and total runner usage, including build transfers and browser installation.
Separate runners can increase CI usage even when elapsed time decreases.

## Interface refinement checks

Use `HERTS_TEST_DIST_DIR` to test staged browser assets.
Select affected tests with `npm run test:ui -- --grep '<affected tests>'`.
Use the full suite when the test selection policy requires it.
Run `npm run test:cross-browser` when changes affect browser-specific behavior or a release requires Firefox and WebKit checks.
Install the matching Playwright browsers and host libraries before these checks.
Browser-engine tests do not replace real-device checks.

The normal task-position fixture uses 390×844 pixels, default text size, short names, no warnings, and collapsed capture.
All six list destinations must remain accessible in the horizontal strip. Keyboard focus must show each complete destination.
The first task must start above the bottom navigation.
Long titles and warnings can move the list down. Task cards expand naturally for their content.

Run `npm run compare:fonts` to generate the Press heading comparison.
The script starts an isolated fixture and downloads licensed comparison fonts when necessary.
It writes screenshots, licenses, checksums, and an HTML gallery to `.runtime/font-comparison`.
It does not change production typography.
Close other browser fixtures before running it.

Record unavailable physical-device checks as unverified.
Check software keyboards, touch gestures, installed apps, enlarged text, and screen-reader labels on supported devices.

## Reviewed action layouts

`review-actions.spec.ts` checks explicit title submission, cancellation, failure recovery, and delayed acknowledgement.
It also checks reading entry modes and offline discussion drafts.
`ui-consistency.spec.ts` checks shared action rows and theme selection at four widths with every built-in theme.
The action checks include a 480-pixel viewport height.
`header-spacing.spec.ts` checks title editors without moving the fixed header.
Inspect the generated screenshots before release. Bounds checks do not prove visual consistency.
