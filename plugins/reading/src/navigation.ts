type ReturnTarget = { itemId: string; href: string; label: string };
const key = 'hertsReadingReturn';
let active: ReturnTarget | undefined;

function itemId(hash: string) { return /^#\/(?:reading-item|reader)\/([^/]+)$/.exec(hash)?.[1]; }
function saved(id: string): ReturnTarget | undefined {
    const value = history.state?.[key];
    return value?.itemId === id && typeof value.href === 'string' && /^#\/(?!\/)/.test(value.href) && typeof value.label === 'string' ? value : undefined;
}
function remember(target: ReturnTarget) {
    active = target;
    history.replaceState({ ...history.state, [key]: target }, '');
}
function origin(hash: string) {
    if (hash === '#/reading' || hash === '#/reading/read') return { href: hash, label: 'Reading list' };
    if (hash === '#/conversations') return { href: hash, label: 'Conversations' };
    if (/^#\/conversation\//.test(hash)) return { href: hash, label: 'Conversation' };
    if (!/^#\/(?!\/)/.test(hash) || /^#\/(?:reading\/add|share)(\/|$)/.test(hash)) return;
    return { href: hash, label: 'Previous page' };
}

export function startReadingNavigation() {
    let previousHash = location.hash;
    const initial = itemId(location.hash);
    active = initial ? saved(initial) : undefined;
    const change = () => {
        if (previousHash === location.hash) return;
        const previous = previousHash;
        previousHash = location.hash;
        const id = itemId(location.hash);
        if (!id) { active = undefined; return; }
        const restored = saved(id);
        if (restored) { active = restored; return; }
        const target = itemId(previous) === id && active?.itemId === id ? active : origin(previous);
        if (target) remember({ ...target, itemId: id });
        else active = undefined;
    };
    addEventListener('popstate', change, true);
    addEventListener('hashchange', change, true);
    return () => { removeEventListener('popstate', change, true); removeEventListener('hashchange', change, true); active = undefined; };
}

export function readingReturnTarget(id: string, read: boolean) {
    return saved(id) || (active?.itemId === id ? active : undefined) || { itemId: id, href: read ? '#/reading/read' : '#/reading', label: 'Reading list' };
}

export function saveReadingReturnTarget(target: ReturnTarget) {
    if (itemId(location.hash) === target.itemId && !saved(target.itemId)) remember(target);
}

export function replaceReadingAlias(from: string, to: string) {
    remember({ ...readingReturnTarget(from, false), itemId: to });
    history.replaceState(history.state, '', `#/reading-item/${to}`);
    dispatchEvent(new PopStateEvent('popstate'));
}
