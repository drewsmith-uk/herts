import { useId, useState } from 'react';
import { Check, ChevronRight, Clock, LoaderCircle, RefreshCw, TriangleAlert, WifiOff } from 'lucide-react';
import { Button, DialogFrame, DialogHeading, StatusMessage } from './ui';
import { refresh, useApp } from './data';
import { connectionStatus } from './connectionStatus';

function StatusIcon({ badge = false }: { badge?: boolean }) {
  const status = connectionStatus(useApp());
  const Icon = { checking: LoaderCircle, offline: WifiOff, warning: TriangleAlert, syncing: RefreshCw, waiting: Clock, synced: Check }[status.kind];
  return <span className={`connection-icon status-${status.kind}${badge ? ' connection-badge' : ''}`} aria-hidden="true">
    {badge && status.kind === 'offline' ? <span className="connection-dot"/> : <Icon size={badge ? 12 : 18} className={['syncing', 'checking'].includes(status.kind) ? 'spin' : ''}/>}
  </span>;
}
export function ConnectionBadge() { return <StatusIcon badge/>; }
export function ConnectionAnnouncement() {
  const status = connectionStatus(useApp());
  return <><span id="connection-status-label" className="visually-hidden" aria-live="polite">Connection status: {status.label}</span><span className="visually-hidden save-state" aria-hidden="true">{status.kind === 'synced' ? 'Changes synced' : status.label}</span></>;
}
export function ConnectionStatusRow() {
  const state = useApp(), status = connectionStatus(state), id = useId();
  const [open, setOpen] = useState(false), [retrying, setRetrying] = useState(false), [error, setError] = useState('');
  async function retry() {
    setRetrying(true); setError('');
    try { await refresh(true); } catch { setError('The connection could not be checked. Try again.'); }
    finally { setRetrying(false); }
  }
  return <>
    <Button className="connection-status-row" aria-label={`Connection status: ${status.label}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <StatusIcon/><span>{status.label}</span><ChevronRight size={18} aria-hidden="true"/>
    </Button>
    {open && <DialogFrame className="connection-dialog" aria-labelledby={id} close={() => setOpen(false)} dismissOnBackdrop>
      <DialogHeading id={id} close={() => setOpen(false)}>Connection and sync</DialogHeading>
      <p role="status">{status.label}</p>
      <dl><dt>Herts</dt><dd>{!state.connectionChecked ? 'Checking connection' : state.online ? 'Connected' : 'Server unavailable'}</dd>
        <dt>Hermes</dt><dd>{!state.online ? 'Unavailable' : state.gateway.online ? 'Connected' : state.gateway.configured ? 'Unavailable' : 'Not configured'}</dd>
        <dt>Sync</dt><dd>{status.pending ? `${status.pending} pending` : 'Up to date'}</dd>
      </dl>
      {(state.error || state.syncError || state.gateway.promptError || error) && <StatusMessage>{state.error || state.syncError || state.gateway.promptError || error}</StatusMessage>}
      <Button disabled={retrying} onClick={() => void retry()}>{retrying ? 'Checking…' : 'Check again'}</Button>
    </DialogFrame>}
  </>;
}
