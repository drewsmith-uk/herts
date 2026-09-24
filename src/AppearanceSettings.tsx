import { SettingsSection, FormField, Button } from './ui';
import { useEffect } from 'react';
import { Palette } from 'lucide-react';
import { refreshThemes, selectTheme, useThemes } from './themes';

export function AppearanceSettings() {
  const state = useThemes();
  useEffect(() => { void refreshThemes(); }, []);
  return <SettingsSection className="appearance-settings" title="Appearance" icon={<Palette size={22}/>} description="Choose a theme for this device. Fieldwork is the default.">
      <FormField htmlFor="appearance-theme" label="Theme">
      <select id="appearance-theme" value={state.selected.id} onChange={event => selectTheme(event.target.value)} aria-describedby="appearance-description">
        {state.themes.map(theme => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
      </select></FormField>
      <p id="appearance-description" className="subtle-note">{state.selected.description}</p>
      {state.notice && <p role="status">{state.notice}</p>}
      {state.refreshError && <p role="status">{state.refreshError}</p>}
      <Button variant="quiet" className="theme-refresh" onClick={() => { void refreshThemes(); }} disabled={state.loading}>
        {state.loading ? 'Checking themes…' : state.refreshError ? 'Try again' : 'Refresh themes'}
      </Button>
      {state.storageError && <p role="status">{state.storageError}</p>}
      {state.errors.length > 0 && <details className="theme-errors"><summary>Some custom themes could not be loaded</summary><ul>{state.errors.map((error, index) => <li key={index}><strong>{error.file}</strong>: {error.message}</li>)}</ul></details>}
  </SettingsSection>;
}
