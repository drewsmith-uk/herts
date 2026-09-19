export interface Link {
    key: string;
    storedId: string;
    title: string;
    source: string;
}
export interface ConversationContext {
    id: string;
    title: string;
    link: Link | null;
    aliases: string[];
}
