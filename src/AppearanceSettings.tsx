import { SettingsSection } from './ui';
import { Palette } from 'lucide-react';
import { selectTheme, useThemes } from './themes';

export function AppearanceSettings() {
  const state = useThemes();
  return <SettingsSection className="appearance-settings" title="Appearance" icon={<Palette size={22}/>}>
      <fieldset className="theme-picker"><legend>Theme on this device</legend><div className="theme-previews">{state.themes.map(theme => <label key={theme.id} className="theme-preview" style={{ background: theme.colors.background, color: theme.colors.text, borderColor: theme.colors.border, fontFamily: theme.typography.headingFont }}>
        <input type="radio" name="appearance-theme" value={theme.id} checked={state.selected.id === theme.id} onChange={() => selectTheme(theme.id)} aria-label={`Use ${theme.name} theme`}/>
        <span className="theme-preview-name">{theme.name}</span><span className="theme-swatches" aria-hidden="true"><i style={{ background: theme.colors.primaryAction }}/><i style={{ background: theme.colors.selected }}/></span>
      </label>)}</div></fieldset>
      {state.notice && <p role="status">{state.notice}</p>}
      {state.storageError && <p role="status">{state.storageError}</p>}
  </SettingsSection>;
}
