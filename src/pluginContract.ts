import type { ComponentType, ReactNode } from 'react';
import type { Conversation, ConversationContext, PluginData, PluginOperation, SharedContent } from '../sdk/types';
export interface RouteProps {
    path: string;
    parts: string[];
    shared?: SharedContent;
    recordRequest?: string;
}
export interface ConversationActionProps {
    context?: ConversationContext;
    conversation: Conversation;
    /** The current view's title, which may differ from the linked conversation title. */
    suggestedTitle?: string;
}
export interface MessageLinkProps {
    href?: string;
    conversationId: string;
    children: ReactNode;
}
export interface ClientPlugin {
    tab?: {
        title: string;
        path: string;
        icon?: ComponentType<{
            size?: number;
        }>;
    };
    routes: {
        match: (path: string) => boolean;
        component: ComponentType<RouteProps>;
    }[];
    Provider?: ComponentType<{
        children: ReactNode;
    }>;
    Sidebar?: ComponentType<RouteProps>;
    Settings?: ComponentType;
    Conflicts?: ComponentType;
    ConversationBadge?: ComponentType<ConversationActionProps>;
    ConversationActions?: ComponentType<ConversationActionProps>;
    MessageLink?: ComponentType<MessageLinkProps>;
    filter?: {
        id: string;
        label: string;
        hiddenMessage?: string;
        visible: (conversation: Conversation, records: Record<string, unknown>, contexts: ConversationContext[]) => boolean;
    };
    swipe?: {
        canRunOffline?: (conversation:Conversation)=>boolean;
        label: (conversation: Conversation) => string;
        run: (conversation: Conversation) => Promise<{
            text: string;
            route?: string;
        } | void>;
    };
    shares?: {
        id: string;
        title: string;
        accepts: (content: SharedContent) => boolean;
        path: string;
    }[];
    shortcuts?: {
        name: string;
        url: string;
        description: string;
    }[];
    reduce?: (records: Record<string, unknown>, operation: PluginOperation) => Record<string, unknown>;
    reconcile?: (result: any, operation: PluginOperation) => Promise<void>;
    start?: () => void | (() => void);
}
export type ActivateClient = () => ClientPlugin;
