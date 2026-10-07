import { createContext, useContext, useId, useLayoutEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';

const classes = (...values: (string | false | undefined)[]) => values.filter(Boolean).join(' ');

export function PageHeader({ eyebrow, title, count, description, actions }: {
  eyebrow?: string; title: ReactNode; count?: number; description?: ReactNode; actions?: ReactNode;
}) {
  return <div className="page-heading page-header"><div className="page-header-copy">
    {eyebrow && <div className="eyebrow">{eyebrow}</div>}
    <h1>{title}{count !== undefined && <> <span className="heading-count">{count}</span></>}</h1>
    {description && <p>{description}</p>}
  </div>{actions && <div className="page-header-actions">{actions}</div>}</div>;
}

type ButtonVariant = 'default' | 'primary' | 'quiet' | 'danger';
const buttonClass = (variant: ButtonVariant) => variant === 'default' ? undefined : `${variant}-button`;
export function Button({ variant = 'default', className, type = 'button', ...props }: ComponentProps<'button'> & { variant?: ButtonVariant }) {
  return <button {...props} type={type} className={classes('ui-button', buttonClass(variant), className)}/>;
}
export function ButtonLink({ variant = 'default', className, ...props }: ComponentProps<'a'> & { variant?: ButtonVariant }) {
  return <a {...props} className={classes('ui-button', buttonClass(variant), className)}/>;
}
export function IconButton({ className, ...props }: ComponentProps<typeof Button> & { 'aria-label': string }) {
  return <Button {...props} className={classes('icon-button', className)}/>;
}

export function SearchField({ label, value, onChange, placeholder = label, disabled = false }: { label: string; value: string; onChange(value: string): void; placeholder?: string; disabled?: boolean }) {
  return <div className="search-field"><Search size={19} aria-hidden="true"/><input type="search" aria-label={label} placeholder={placeholder} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}/>{value && <IconButton aria-label={`Clear ${label.toLowerCase()}`} disabled={disabled} onClick={() => onChange('')}><X size={16}/></IconButton>}</div>;
}

export function DialogHeading({ id, children, close, busy = false }: { id: string; children: ReactNode; close(): void; busy?: boolean }) {
  return <div className="dialog-heading"><h2 id={id}>{children}</h2><IconButton aria-label="Close dialog" disabled={busy} onClick={close}><X size={20}/></IconButton></div>;
}

export function FormDialog({ id, title, close, busy, onSubmit, children, footer, error }: { id:string; title:ReactNode;close():void;busy?:boolean;onSubmit:ComponentProps<'form'>['onSubmit'];children:ReactNode;footer:ReactNode;error?:string }) {
  const alert = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if(error) alert.current?.focus(); }, [error]);
  return <DialogFrame className="form-dialog" size="wide" close={close} busy={busy} aria-labelledby={id}>
    <form onSubmit={onSubmit}><DialogHeading id={id} close={close} busy={busy}>{title}</DialogHeading>
      <div className="form-dialog-body">{children}</div>
      <div className="form-dialog-footer">{error && <div ref={alert} tabIndex={-1} role="alert" className="inline-error">{error}</div>}{footer}</div>
    </form>
  </DialogFrame>;
}

export function SectionNav({ variant = 'filters', className, ...props }: ComponentProps<'nav'> & { variant?: 'filters' | 'sections'; 'aria-label': string }) {
  return <nav {...props} className={classes('section-nav', `section-nav--${variant}`, className)}/>;
}
export function SectionLink({ active, className, ...props }: ComponentProps<'a'> & { active?: boolean }) {
  return <a {...props} aria-current={active ? 'page' : undefined} className={classes(active && 'active', className)}/>;
}

export function ItemList({ divided, className, ...props }: ComponentProps<'div'> & { divided?: boolean }) {
  return <div {...props} className={classes('item-list', divided && 'item-list--divided', className)}/>;
}
type RowSlots = { leading?: ReactNode; trailing?: ReactNode; children: ReactNode; variant?: 'card' | 'preview' };
type ItemRowProps = RowSlots & (ComponentProps<'div'> & { href?: never } | ComponentProps<'a'> & { href: string });
export function ItemRow({ leading, trailing, children, variant = 'card', className, ...props }: ItemRowProps) {
  const rowClass = classes('item-row', `item-row--${variant}`, className);
  const content = <>{leading && <div className="item-row-leading">{leading}</div>}<div className="item-row-body">{children}</div>{trailing && <div className="item-row-actions">{trailing}</div>}</>;
  if (props.href !== undefined) return <a {...props as ComponentProps<'a'>} className={rowClass}>{content}</a>;
  return <div {...props as ComponentProps<'div'>} className={rowClass}>{content}</div>;
}
export function ItemMeta({ className, ...props }: ComponentProps<'div'>) {
  return <div {...props} className={classes('item-meta', 'task-meta', className)}/>;
}

const SettingsDepth = createContext(0);
export function SettingsSection({ title, icon, description, actions, headingId, className, children, ...props }: Omit<ComponentProps<'section'>, 'title'> & {
  title: ReactNode; icon?: ReactNode; description?: ReactNode; actions?: ReactNode; headingId?: string;
}) {
  const depth = useContext(SettingsDepth), generatedId = useId(), id = headingId || generatedId;
  return <section {...props} aria-labelledby={id} className={classes('settings-card', 'settings-section', depth > 0 && 'settings-subsection', className)}>
    <div className="settings-section-heading">{icon && <div className="settings-icon" aria-hidden="true">{icon}</div>}<h2 id={id}>{title}</h2>{actions && <div className="settings-section-actions">{actions}</div>}</div>
    <div className="settings-section-body">{description && <p>{description}</p>}<SettingsDepth.Provider value={depth + 1}>{children}</SettingsDepth.Provider></div>
  </section>;
}
export function SettingRow({ label, htmlFor, description, control }: { label: ReactNode; htmlFor: string; description?: ReactNode; control: ReactNode }) {
  return <div className="setting-row"><div><label htmlFor={htmlFor}>{label}</label>{description && <p>{description}</p>}</div><div className="setting-row-control">{control}</div></div>;
}
export function FormField({ label, htmlFor, className, children, ...props }: ComponentProps<'label'> & { label: ReactNode }) {
  if (htmlFor) return <div className={classes('form-field', className)}><label {...props} htmlFor={htmlFor}>{label}</label>{children}</div>;
  return <label {...props} className={classes('form-field', className)}><span>{label}</span>{children}</label>;
}
export function EmptyState({ icon, title, description, children, className }: { icon: ReactNode; title: string; description: ReactNode; children?: ReactNode; className?: string }) {
  return <div className={classes('empty', className)}><div className="empty-icon" aria-hidden="true">{icon}</div><h2>{title}</h2><p>{description}</p>{children}</div>;
}
export function StatusMessage({ tone = 'error', className, ...props }: ComponentProps<'div'> & { tone?: 'error' | 'notice' | 'warning' }) {
  return <div role={tone === 'error' ? 'alert' : 'status'} {...props} className={classes('status-message', tone === 'error' ? 'inline-error' : `status-message--${tone}`, className)}/>;
}

// The native dialog owns focus trapping and restoration. Domain components keep
// their submit/validation logic and decide whether backdrop dismissal is safe.
export function DialogFrame({ close, busy = false, dismissOnBackdrop = false, size = 'compact', className, children, ...props }: Omit<ComponentProps<'dialog'>, 'ref' | 'open' | 'onCancel' | 'onClick'> & {
  close: () => void; busy?: boolean; dismissOnBackdrop?: boolean; size?: 'compact' | 'wide'; 'aria-labelledby': string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => { const node = dialog.current!; node.showModal(); return () => { if (node.open) node.close(); }; }, []);
  return <dialog {...props} ref={dialog} className={classes('dialog-frame', `dialog-frame--${size}`, className)} onCancel={event => { event.preventDefault(); if (!busy) close(); }} onClick={event => {
    if (!dismissOnBackdrop || busy || event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
  }}>{children}</dialog>;
}
