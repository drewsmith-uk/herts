export const styles = `
.reviewed-values { white-space:pre-wrap;overflow-wrap:anywhere; }
.bot-results { min-width:0; }
.bot-results .page-header { margin-block:16px; }
.bot-results .markdown pre { max-width:100%;overflow:auto; }
.bot-results .markdown table { display:block;max-width:100%;overflow:auto; }
.bots { display:flex;flex-direction:column;gap:16px;min-width:0;min-height:0; }
.bots .page-header { margin-bottom:0; }
.bots-chat { flex:1;gap:0; }
.bots-toolbar { display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px; }
.bots-back { align-self:flex-start;border-color:transparent;background:transparent;padding-inline:0; }
.bots-toolbar .quiet-button { border-color:transparent;background:transparent;color:var(--color-text-secondary); }
.bots-filter { display:flex;align-items:center;gap:8px;min-height:44px;font-size:var(--text-secondary); }
.bots-filter input { width:20px;height:20px; }
.bot-list-item { display:flex;align-items:center;gap:4px;min-width:0; }
.bot-list-item>.item-row { flex:1;min-width:0; }
.bot-list-item .item-row { align-items:flex-start; }
.bot-list-item .item-row-leading { padding-top:4px; }
.bots .item-title,.bots .item-preview,.bots .form-hint { overflow-wrap:anywhere; }
.bots .item-title { margin:0; }
.bots-roster { grid-auto-rows:1fr; }
.bots-roster .conversation-item-content,.bots-roster .item-row { height:100%; }
.bots-roster .item-preview { min-height:1lh; }
.bot-description { margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;font-size:var(--text-secondary);color:var(--color-text-secondary); }
.bots-avatar { display:grid;place-items:center;flex-shrink:0;width:40px;height:40px;border-radius:50%;object-fit:cover;background:var(--color-surface-muted);border:var(--border-width,1px) solid var(--color-border);font-weight:600; }
.bot-identity { display:flex;gap:12px;align-items:center;min-width:0; }
.bot-identity>div { min-width:0; }
.bot-identity h1 { font-size:1.15rem;overflow-wrap:anywhere; }
.bots .conversation-header-details>.button-row { margin-top:12px; }
.bot-status { display:flex;flex-wrap:wrap;gap:8px;align-items:center; }
.bots-dialog { overflow-wrap:anywhere; }
.bots-dialog form { gap:16px; }
.bots-dialog details>summary { cursor:pointer;min-height:44px;padding-block:10px;font-weight:600; }
.bots-dialog details>fieldset { margin-top:12px; }
.bots-dialog .form-field { margin:0; }
.bots-dialog .dialog-actions .button-row { justify-content:flex-end; }
.bots-dialog .draft-status { font-size:var(--text-meta);margin-bottom:8px; }
.bots-dialog .markdown { min-width:0;overflow-wrap:anywhere; }
.bots-dialog .markdown pre { max-width:100%;overflow:auto; }
.bots-dialog .markdown table { display:block;max-width:100%;overflow:auto; }
.bot-routine .item-row-leading { align-self:flex-start;padding-top:4px; }
.bot-routine .button-row { margin-top:12px; }
.bot-routine details { margin-top:8px; }
.bot-routine details summary { min-height:44px;display:list-item;align-content:center;cursor:pointer;color:var(--color-text-secondary);font-size:var(--text-secondary); }
.bot-routine details p { white-space:pre-wrap;overflow-wrap:anywhere; }
.bot-activity-item { padding-block:16px;border-bottom:var(--border-width,1px) solid var(--color-border); }
.bot-activity-item h3 { font-size:var(--text-body);margin:0;overflow-wrap:anywhere; }
.bot-activity-item .button-row { margin-top:8px; }
.bots-loading { display:flex;align-items:center;gap:8px;color:var(--color-text-secondary);font-size:var(--text-secondary); }
.bots-chat>.status-message { flex-shrink:0;max-height:20dvh;overflow:auto;margin:8px 0; }
`;
