# Working on Herts

## UI completion criteria

Before implementing a screen, inspect its closest existing Herts equivalent and the shared components in `src/ui.tsx`, `src/ui.css` and `sdk/client.ts`. Reuse the app's search, list, form, dialog, message rendering, draft and conversation patterns. Add missing primitives to the shared layer instead of copying an approximate version into a plugin.

A working happy path is not enough to complete a UI change. For every new or substantially changed screen:

- Include it in the shared browser UI coverage (`tests/browser/ui-consistency.spec.ts`). Check 320, 390, 768 and 1280px layouts and every built-in theme. Include a short viewport for fixed-height conversation layouts.
- Exercise realistic long titles, URLs, descriptions and output; verify field and page bounds, full navigation targets, keyboard focus and dialog dismissal. Inspect actual screenshots alongside the closest existing screen; passing bounds checks alone is insufficient.
- Verify loading, empty, filtered-empty, offline, cached, failure and retry states. Keep existing drafts accessible offline. Distinguish server connectivity from a missing record.
- Delay mutations and reads. Protect edits through both submission and draft acknowledgement; ignore obsolete responses. Unknown remote effects must not be automatically repeated.
- Cover regressions with behavioral tests, including data preservation and recovery. Use isolated synthetic data, never live bots or model prompts for validation.
- State what was tested and any remaining limits. Do not claim visual consistency from workflow test counts.

Run `npm run test:ui` for affected UI and `npm run check:release` before finishing a release. The Quality workflow runs release checks on pull requests. It must be configured as a required status check in repository branch protection to enforce a merge gate.

## Updating the running installation

Build and test before replacing the served browser bundle. The browser fixture accepts `HERTS_TEST_DIST_DIR` for a staged Vite build. Preserve previous hashed assets for existing clients.

Browser App updates, server restart, and plugin-package Update are separate steps. Apply all steps needed by the change; verify the running service and plugin, not merely files on disk. Retain a private backup before server/data upgrades and restart only the Herts app service when appropriate. Existing installations may use `hermes-tasks.service` rather than `herts.service`. Never restart the Hermes backend merely to load Herts changes.
