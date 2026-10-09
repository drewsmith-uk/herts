# Herts themes

Press is the default. Choose Fieldwork, Edition, Signal, Nocturne, Studio, Press or an installed custom theme in **Settings → General → Appearance**. Selection is saved per browser/device, shared between tabs of that browser, and restored before the app renders. It is independent of Hermes session settings and does not start or interrupt any work.

**Press** uses warm paper, black outlines, heavy headings, cobalt actions and yellow selections. Its optional `treatment` settings add borders, hard action shadows, monospaced labels, and filled navigation highlights. Other themes keep their existing styling.

## Install a custom theme

1. Copy `woodland.json.example` to `woodland.json` in this folder.
2. Edit the JSON and give the theme its own `id` and `name`.
3. Select **Refresh themes** in Appearance, or reopen General settings. The theme appears in the selector immediately. This change requires no build or server restart.

By default, custom files are read from `themes/` relative to the server's working directory. Set **`HERTS_THEMES_DIR=/absolute/path/to/themes`** for an installation-local directory outside the checkout. Changing that environment variable requires restarting the app; adding/editing theme files does not. Back up that directory separately when it is outside your normal backup.

Only top-level `*.json` files are read. The bundled files in `builtin/` are compiled into the app as a guaranteed offline fallback; changing built-ins requires a build. Create a custom file using `extends` to make runtime variations. Built-in IDs cannot be replaced by custom files.

## Configuration

```json
{
  "schemaVersion": 1,
  "id": "woodland",
  "name": "Woodland",
  "description": "A softer green variation of Fieldwork.",
  "extends": "fieldwork",
  "colors": {
    "background": "#EEF1E9",
    "primaryAction": "#34513B",
    "primaryActionHover": "#263E2C",
    "primaryActionText": "#FFFFFF"
  },
  "typography": { "headingFont": "Georgia, serif" },
  "radii": { "control": 8, "panel": 10, "small": 4 },
  "elevation": "flat"
}
```

`schemaVersion`, `id` and `name` are required. IDs use lowercase letters, numbers and hyphens, beginning with a letter. The default parent is Fieldwork. A theme can extend any built-in or another custom theme, regardless of filename order. Nested colour/type/radius/treatment settings merge by key; a supplied `fonts` list replaces its parent's list. Cycles, missing parents, duplicate custom IDs, unknown fields and unsupported schema versions are rejected. One invalid file does not prevent unrelated themes from loading.

| Setting | Accepted values |
| --- | --- |
| `description` | Optional description, up to 200 characters |
| `mode` | `light` or `dark`; controls native form controls and browser colour scheme |
| `colors` | Six-digit hex colours. `backdrop` and `shadow` also accept eight digits for alpha |
| `typography.bodyFont` | A font-family stack for body text and controls |
| `typography.headingFont` | A font-family stack for page titles and the Herts wordmark |
| `typography.monoFont` | A font-family stack for code |
| `typography.headingWeight` | Integer from 400 to 900 |
| `radii.control`, `radii.panel`, `radii.small` | Numbers from 0 to 20, in CSS pixels |
| `elevation` | `flat`, `soft` or `raised`; floating dialogs retain their own shadow |
| `fonts` | Optional list of locally hosted WOFF2 font definitions |
| `treatment.borderWidth` | Number from 1 to 2, in CSS pixels; default `1` |
| `treatment.actionShadow` | Hard shadow offset from 0 to 4 pixels on primary actions; default `0`. Positive values also give floating dialogs an offset shadow one pixel larger. Uses `colors.shadow` |
| `treatment.labels` | `body` (default) or `mono`, for short section/ordering labels |
| `treatment.navigation` | `indicator` (default) or `filled`, for active navigation outlines and mobile selection fills |

For a variation of Press, use `"extends": "press"`. Override individual treatment values to soften the style, for example `"treatment": { "borderWidth": 1, "actionShadow": 0 }`. Omitting `treatment` in an existing config preserves its previous styling; descendants of Press inherit its settings.

Colour roles:

```text
background, surface, surfaceMuted, surfaceHover
text, textSecondary, border, controlBorder, link
primaryAction, primaryActionHover, primaryActionText
selected, selectedText, focus
sidebar, sidebarText, sidebarMuted, sidebarSelected,
sidebarSelectedText, sidebarBorder
userMessage, code
success, successSurface
warning, warningSurface, warningBorder
danger, dangerSurface, dangerBorder
backdrop, shadow
```

For a custom dark theme, extend `nocturne` so the inherited text, notices and controls also suit dark surfaces. Setting `mode` alone does not generate a dark palette. When changing an action or selected background, check its paired text colour too. Built-in palettes have contrast tests; arbitrary custom palettes need their own visual/contrast review.

## Local fonts

System font stacks require no downloads. A font stack lists fonts in order of preference. To package a font, place a licensed WOFF2 file inside the configured themes directory and reference its relative path:

```json
{
  "schemaVersion": 1,
  "id": "local-font",
  "name": "Local font",
  "extends": "fieldwork",
  "fonts": [
    { "family": "My Sans", "file": "fonts/my-sans.woff2", "weight": "100 900", "style": "normal" }
  ],
  "typography": {
    "bodyFont": "My Sans, system-ui, sans-serif",
    "headingFont": "My Sans, system-ui, sans-serif"
  }
}
```

Use an appropriate weight or weight range for the font file, and `normal` or `italic` style. Always include a system fallback. Herts applies its private access checks to font requests. Fonts use content-hashed URLs. Selecting a theme caches its fonts on the device. Updated font files receive new URLs. Fonts not yet downloaded use the fallback while offline. Remote font URLs, arbitrary CSS/JavaScript and paths outside the theme directory are not accepted.

The theme catalogue has these limits:

- 64 custom configuration files.
- 64 KB per configuration file.
- Eight fonts per theme.
- 2 MB per font.
- 16 MB of distinct fonts per catalogue.
 A missing/invalid font makes its theme unavailable; other themes continue working.

## Offline and recovery

The theme catalogue and selected appearance are saved in local storage, independently of task and conversation data. Network failure retains the cached appearance. When an online refresh confirms that the selected custom theme is invalid or removed, Herts falls back to Press. Settings shows diagnostics for invalid files. If browser storage is unavailable, the selection still applies to the current page. A message explains that Herts could not save it. Clearing browser storage resets the theme preference.

If the theme list cannot be refreshed, Appearance explains the failure and offers **Try again**. The themes already listed remain usable. Offline devices retry automatically when they reconnect. After an app update, the server might not provide a theme list. Restart the Herts app service to load the new server code. Then retry. This restart is needed when updating Herts itself, not when adding custom theme files.

The updated app requests the catalogue with `X-Herts-Theme-API: 3`. Version 2 clients keep Fieldwork as their default. Older clients receive the original fields and supported heading weights. This keeps older clients usable while their app update is pending. Existing saved themes and config files remain compatible.

Themes affect presentation, not page layouts, navigation order, touch targets, features or behaviour. Installed-app launch and splash colours use Press. Browser chrome follows the selected theme where the browser supports it.

## Plugin styling

Use the shared variables so plugin content follows the selected theme. Colour keys become kebab-case CSS properties, for example `colors.textSecondary` becomes `--color-text-secondary`:

```css
.my-plugin-panel {
  color: var(--color-text);
  background: var(--color-surface);
  border: var(--border-width, 1px) solid var(--color-border);
  border-radius: var(--radius-panel);
  font-family: var(--font-body);
  box-shadow: var(--shadow-surface);
}
```

Also available: `--font-heading`, `--font-mono`, `--font-label`, `--weight-heading`, `--radius-control`, `--radius-small`, `--shadow-action`, `--shadow-floating`, `--shadow-nav-active`, `--shadow-tab-active`, `--mobile-active-background`, and a `data-theme` attribute on the document root. Prefer semantic variables to styling for specific theme IDs. Legacy `--ink`, `--muted`, `--blue`, `--border` and `--surface` remain aliases. Plugins with their own hard-coded colours must adopt the variables to support all themes.
