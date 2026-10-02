# Testing and release checks

Use Node.js 24+, Python 3 and a clean checkout with `npm ci`. Do not point test environments at production data or a real Hermes backend.

```sh
npm run check
npm run test:installer
npx playwright install --with-deps chromium
npm run test:browser
```

Unit/API tests cover fresh core-only installations, plugin discovery, independent Notes activation, migration/receipt preservation, immutable package updates, failed migrations, disable/remove/re-add, reset generation fences, late writes, catch-up reminders, and task ordering, spaces, snoozes, reading deduplication and title edits, authenticated access, upload recovery, uncertain action receipts, profile selection/identity checks, reconnects, approvals, event replay and notifications. Installer tests use temporary paths and mocked systemd and check both modes, dry runs, idempotent reruns, conflicting files, occupied ports, named profiles and quoting.

Browser tests launch a temporary app and fake Hermes (8790/8791). They exercise phone/desktop layouts, drag/drop, accessible controls, offline sync/conflicts, shared reading conversations, recording recovery, message activity, history, notification navigation, app-update prompts and existing browser storage. Update tests use real service workers and cover offline changes, drafts and attachments, other open windows, failed installation/storage, reviewable voice drafts, and accepted or unconfirmed Hermes submissions. Plugin browser tests also cover core operation with both built-ins disabled, dynamic third-party installation and cross-plugin hooks, and resetting while another device has offline edits. They do not send production prompts or real push notifications. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` optionally overrides Playwright's normal browser location. The full Chromium channel runs headlessly so service-worker push tests use the browser runtime.

For a release:

1. Run the checks in a clean clone at a different filesystem path. Verify production-only dependency installation still includes the `tsx` runtime used by the service.
2. Review only tracked/exported source. Exclude `.git` from any fresh-history export and exclude all ignored data, environment files, recordings, screenshots, traces, backups and browser profiles.
3. Scan all Git refs with Gitleaks (`gitleaks git . --log-opts=--all --redact=100`) and built assets (`gitleaks dir dist --redact=100`, `gitleaks dir plugins --redact=100`, and `gitleaks dir examples --redact=100`). Inspect flagged files without publishing their values. `.env.example` must contain examples only. Also inspect personal identifiers, filenames, document metadata, test fixtures and commit author metadata; a secret scanner is not a personal-data audit.
4. Check `npm audit`, licence attribution and the installation/upgrade instructions. CI uses pinned Actions revisions and a checksum-verified scanner and requires no live credentials. Failed browser tests retain screenshots, error context and traces for seven days; these must contain only synthetic fixture data. Review retained artifacts as well as logs before publication.
5. Back up privately before applying an update. Preserve app origin/PWA identity, service-worker URL, storage keys, notification keys and old request compatibility. Test an existing browser with pending edits/drafts and an older service worker before removing old static assets.
6. Restart only the app and run the read-only connection check. Verify the existing backend process remains alive. Keep the old build and data backup for rollback.

Before changing repository visibility, review all reachable remote Git refs and retained Actions logs as well as source files; logs become public too. Require a green full CI run for the release commit. Enable Dependabot alerts and review its scheduled updates. At publication, enable private vulnerability reporting and secret scanning/push protection, require the `check` job on `main`, disallow force-pushes/deletion, and require approval of workflows from outside contributors. Some settings are unavailable on a free private repository and must be applied immediately after the visibility change. Recheck them rather than assuming the private settings carry over. Publishing source does not authorise exposing the running app publicly.

Licence notices are generated from the actual browser/plugin build inputs. A build fails if a bundled dependency has no licence file. Verify `dist/THIRD_PARTY_NOTICES.txt` and each prepared package's notice file accompany a distributed build. Server dependencies installed with npm retain their own packaged notices.

Secret scans reduce risk but cannot prove the absence of every possible secret or private detail. If a real credential is discovered in published content, revoke/rotate it and remove the exposure; deleting only the current file is insufficient.

Conversation settings tests cover local-only staging, profile-scoped/sanitised reads, revision conflicts, defaults precedence, busy-session refusal, model confirmations, partial failures and lost replies without duplicate writes or messages. Browser fixtures exercise the same controls on phone/desktop and in Tasks/Reading, offline reloads, default settings and explicit Send. The fixture model catalogue and server folders contain only synthetic data; these tests do not invoke your Hermes installation.

Security regressions use synthetic deeply nested article HTML, malformed attachment references and conversation links, and saved messages with private fixture attachments. They check worker deadlines and cancellation, continued API responsiveness, parser backoff, old Reading plugin compatibility, recovery without losing the conversation controls, deletion of server and browser copies, upgrade cleanup, and retained protection against duplicate uncertain sends.
