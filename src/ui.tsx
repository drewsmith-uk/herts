import { createContext, useContext, useId, useLayoutEffect, useRef, type ComponentProps, type ReactNode } from 'react';

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
