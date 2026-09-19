import type { Conversation } from '../shared/core.js';
import type { ConversationContext, Link } from '../shared/conversations.js';
export type { ConversationContext, Link } from '../shared/conversations.js';
export type { PluginManifest, PluginOperation } from '../shared/plugins.js';
export interface ResolvedConversation {
    link: Link;
    aliases: string[];
}
export interface PluginNotice {
    id: string;
    title: string;
    body: string;
    route: string;
    contextId?: string;
}
export interface Transaction {
    get<T>(key: string): T | undefined;
    put(key: string, value: unknown): void;
    delete(key: string): void;
    entries<T>(prefix?: string): [
        string,
        T
    ][];
    context(id: string): ConversationContext | undefined;
    contexts(): ConversationContext[];
    createContext(context: ConversationContext): ConversationContext;
    ensureContext(conversation: ResolvedConversation, preferred?: string): ConversationContext;
    reference(id: string, contextId: string): void;
    notify(notice: PluginNotice): void;
}
export interface ReadablePage {
    url: string;
    title: string;
    byline: string;
    siteName: string;
    html: string;
    text: string;
    fetchedAt: number;
    status: 'saved' | 'excerpt' | 'unavailable';
    warning: string;
}
export interface ServerServices {
    web: {
        fetchHtml: (url: string, signal: AbortSignal) => Promise<{
            html: string;
            url: string;
        }>;
        extractArticle: (html: string, url: string) => ReadablePage;
    };
    readonly id: string;
    readonly generation: number;
    readonly signal: AbortSignal;
    readonly resumed: boolean;
    get<T>(key: string): T | undefined;
    entries<T>(prefix?: string): [
        string,
        T
    ][];
    transaction<T>(fn: (tx: Transaction) => T): T;
    contexts(): ConversationContext[];
    context(id: string): ConversationContext | undefined;
    resolveConversation(id: string): Promise<ResolvedConversation>;
    onChange(fn: () => void): () => void;
    interval(fn: () => void | Promise<void>, milliseconds: number): () => void;
    files: {
        read(key: string): Promise<Uint8Array | undefined>;
        write(key: string, bytes: Uint8Array): Promise<void>;
        remove(key: string): Promise<void>;
    };
}
export interface Command {
    prepare?(input: any, api: ServerServices): Promise<unknown>;
    apply(input: any, tx: Transaction, prepared?: any): unknown;
}
export interface ServerPlugin {
    migrate?(from: number, tx: Transaction): void;
    commands?: Record<string, Command>;
    queries?: Record<string, (input: any) => unknown | Promise<unknown>>;
    start?(): void | Promise<void>;
    dispose?(): void | Promise<void>;
    conversationList?(conversation: Conversation): {
        filters?: string[];
        data?: Record<string, unknown>;
    };
    conversation?(context: ConversationContext): {
        route: string;
        title: string;
    } | undefined;
}
export type ActivateServer = (api: ServerServices) => ServerPlugin | Promise<ServerPlugin>;
