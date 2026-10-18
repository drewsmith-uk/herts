# Herts themes

Choose Fieldwork, Edition, Signal, Nocturne, Studio, or Press in **Settings → General → Appearance**.
Press is the default theme.
Herts saves the selection for each browser and shares it between tabs in that browser.
Herts applies the saved theme before the app renders.
Theme selection does not change Hermes session settings or start work.

## Supported themes

Herts supports only the six built-in themes.
Custom theme files, custom fonts, and `HERTS_THEMES_DIR` are no longer supported.
Older custom selections use Press after an update.
The update does not delete existing theme files from the server.

Built-in themes use system fonts and work offline.
Changes to their source files require a browser build.
Use shared components to keep layouts consistent across themes.

## Storage and updates

Herts retains the existing appearance storage key.
It reads only the selected built-in theme ID from saved settings.
It ignores saved colours, fonts, and custom catalogues.
If browser storage fails, the selected theme remains active until the page closes.
Appearance shows a message when Herts cannot save the selection.

Older clients can still request built-in themes from the theme API.
The server no longer serves custom font files.
The updated service worker removes the obsolete theme-font cache when it activates.

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
