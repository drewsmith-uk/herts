export type { ClientPlugin, RouteProps, ConversationActionProps, MessageLinkProps } from '../src/pluginContract';
export type { State as CoreState } from '../src/data';
export type { Draft, LocalFile, Recording, PendingPlugin } from '../src/data';
export * from './types';
export { useApp as useCore, getState as getCore, refresh, sync, api, publish, submit, addFile, uploadFile, cacheRead, createLocalConversation, contextForConversation, openConversation } from '../src/data';
export { pluginLocal, pluginRecords, usePluginRecords, pluginQuery, mutatePlugin, resolvePluginOperation, rebuild, liveQuery } from '../src/pluginApi';
export { useUpdatePreparation, useUpdateWork, useDraftPersistence, prepareForUpdate } from '../src/updateSafety';
export { ConversationPanel, HistoryView } from '../src/Conversation';
export { ConversationHeader } from '../src/ConversationHeader';
export { PluginVoice as Voice } from '../src/plugins';
export { useHoldSensors, useDragClickGuard, holdListeners } from '../src/dragging';
import { db } from '../src/data';
export const conversationDrafts = db.drafts;
export { PageHeader, Button, ButtonLink, IconButton, SectionNav, SectionLink, ItemList, ItemRow, ItemMeta, SettingsSection, SettingRow, FormField, EmptyState, StatusMessage, DialogFrame } from '../src/ui';

export { MessageComposer, ComposerPlaceholder, composerCapabilities, type MessageComposerProps } from '../src/MessageComposer';
export { useEntryDraft, entryDraftStatus, firstLine, type CaptureAdapter } from '../src/entryDraft';

export { performPluginAction, pluginActionStatus } from '../src/pluginApi';
export { SearchField, DialogHeading } from '../src/ui';
export { useListState } from '../src/listState';
export { MessageMarkdown } from '../src/MessageMarkdown';

export { FormDialog } from '../src/ui';
export { SwipeRow } from '../src/SwipeRow';
export { ModelPicker } from '../src/ModelPicker';

export { MessageAuthor } from '../src/MessageAuthor';
export { useMessageSpeech } from '../src/useMessageSpeech';

export { reviewPluginAction } from '../src/pluginApi';
export { pluginNotifications, type DeviceNotification, type DeviceNotificationInput } from '../src/pluginNotifications';
export { subscribeCore } from '../src/data';
export { getConversationTitle } from '../src/plugins';

export { undoableAction } from '../src/UndoToast';

export { ActionMenu, ListPlaceholder } from '../src/ui';
export { messagePreview, compactDate, readingTitle } from '../shared/messagePreview';

export { ActionRow, ActionRowLink, SettingsGroup } from '../src/ui';
export { RenameAction } from '../src/RenameAction';

export { DragHandle, DragPreview } from '../src/ui';
