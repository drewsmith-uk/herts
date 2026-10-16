import { SettingsSection, Button } from './ui';
import { useEffect } from 'react';
import { Palette } from 'lucide-react';
import { refreshThemes, selectTheme, useThemes } from './themes';

export function AppearanceSettings() {
  const state = useThemes();
  useEffect(() => { void refreshThemes(); }, []);
  return <SettingsSection className="appearance-settings" title="Appearance" icon={<Palette size={22}/>}>
      <fieldset className="theme-picker"><legend>Theme on this device</legend><div className="theme-previews">{state.themes.map(theme => <label key={theme.id} className="theme-preview" style={{ background: theme.colors.background, color: theme.colors.text, borderColor: theme.colors.border, fontFamily: theme.typography.headingFont }}>
        <input type="radio" name="appearance-theme" value={theme.id} checked={state.selected.id === theme.id} onChange={() => selectTheme(theme.id)} aria-label={`Use ${theme.name} theme`}/>
        <span className="theme-preview-name">{theme.name}</span><span className="theme-swatches" aria-hidden="true"><i style={{ background: theme.colors.primaryAction }}/><i style={{ background: theme.colors.selected }}/></span>
      </label>)}</div></fieldset>
      {state.notice && <p role="status">{state.notice}</p>}
      {state.refreshError && <p role="status">{state.refreshError} <Button disabled={state.loading} onClick={() => void refreshThemes()}>Try again</Button></p>}
      <details className="custom-themes"><summary>Custom themes</summary><Button variant="quiet" className="theme-refresh" onClick={() => { void refreshThemes(); }} disabled={state.loading}>
        {state.loading ? 'Checking themes…' : 'Refresh themes'}
      </Button></details>
      {state.storageError && <p role="status">{state.storageError}</p>}
      {state.errors.length > 0 && <details className="theme-errors"><summary>Some custom themes could not be loaded</summary><ul>{state.errors.map((error, index) => <li key={index}><strong>{error.file}</strong>: {error.message}</li>)}</ul></details>}
  </SettingsSection>;
}
