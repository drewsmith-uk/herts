# Testing and release checks

Use Node.js 24+, Python 3 and a clean checkout with `npm ci`. Do not point test environments at production data or a real Hermes backend.

```sh
npm run check
npm run test:installer
npx playwright install --with-deps chromium
npm run test:browser
```

Unit/API tests cover task ordering, spaces, snoozes, reading deduplication and title edits, authenticated access, upload recovery, uncertain action receipts, profile selection/identity checks, reconnects, approvals, event replay and notifications. Installer tests use temporary paths and mocked systemd and check both modes, dry runs, idempotent reruns, conflicting files, occupied ports, named profiles and quoting.

Browser tests launch a temporary app and fake Hermes (8790/8791). They exercise phone/desktop layouts, drag/drop, accessible controls, offline sync/conflicts, shared reading conversations, recording recovery, message activity, history, notification navigation and existing browser storage. They do not send production prompts or real push notifications. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` optionally overrides Playwright's normal browser location.

For a release:

1. Run the checks in a clean clone at a different filesystem path. Verify production-only dependency installation still includes the `tsx` runtime used by the service.
2. Review only tracked/exported source. Exclude `.git` from any fresh-history export and exclude all ignored data, environment files, recordings, screenshots, traces, backups and browser profiles.
3. Scan all Git refs with Gitleaks (`gitleaks git . --log-opts=--all --redact=100`) and built assets (`gitleaks dir dist --redact=100`). Inspect flagged files without publishing their values. `.env.example` must contain examples only. Also inspect personal identifiers, filenames, document metadata, test fixtures and commit author metadata; a secret scanner is not a personal-data audit.
4. Check `npm audit`, licence attribution and the installation/upgrade instructions. CI uses pinned Actions revisions and a checksum-verified scanner, requires no live credentials, and uploads no browser artifacts.
5. Back up privately before applying an update. Preserve app origin/PWA identity, service-worker URL, storage keys, notification keys and old request compatibility. Test an existing browser with pending edits/drafts and an older service worker before removing old static assets.
6. Restart only the app and run the read-only connection check. Verify the existing backend process remains alive. Keep the old build and data backup for rollback.

Secret scans reduce risk but cannot prove the absence of every possible secret or private detail. If a real credential is discovered in published content, revoke/rotate it and remove the exposure; deleting only the current file is insufficient.
