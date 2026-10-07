export interface Link {
    profile?: string;
    botChat?: boolean;
    key: string;
    storedId: string;
    title: string;
    source: string;
}
export interface ConversationContext {
    profile?: string;
    botChat?: boolean;
    id: string;
    title: string;
    link: Link | null;
    aliases: string[];
}

/** Opaque app identities; legacy/default-profile IDs retain their existing spelling. */
export function conversationRef(profile: string, id: string, defaultProfile = 'default'): string {
    return profile === defaultProfile ? id : `herts-profile:${profile}:${encodeURIComponent(id)}`;
}
export function parseConversationRef(id: string): { profile?: string; id: string } {
    if (!id.startsWith('herts-profile:')) return { id };
    const match = /^herts-profile:([a-z0-9][a-z0-9_-]{0,63}):(.+)$/.exec(id);
    if (!match) throw new Error('Invalid conversation identity.');
    return { profile: match[1], id: decodeURIComponent(match[2]) };
}
