import { Inbox, Link2 } from 'lucide-react';
import type { ClientPlugin } from '@herts/plugin-api/client';
import { PageHeader } from '@herts/plugin-api/client';
import { applyTaskOp, applySpaceOp, emptySnapshot, conversationTaskId, type Snapshot } from './model';
import { TasksScreen, TasksSidebar, TaskActions, TaskConflicts } from './Tasks';
import { TaskDragging } from './TaskDragging';
import { SpaceSettings } from './Spaces';
import { createTaskFromConversation, initialiseTasks, linkedTaskId, taskInboxName, useApp } from './data';
function TaskBadge({conversation}:import('@herts/plugin-api/client').ConversationActionProps){useApp();return linkedTaskId(conversation)?<span><Link2 size={12}/>Task created</span>:null;}
export default function activate(): ClientPlugin {
    if (!PageHeader) throw new Error('Update Herts in Settings → App updates to use this version of Tasks.');
    return {
        tab: { title: 'Tasks', path: '/tasks', icon: Inbox },
        routes: [{ match: path => /^\/(tasks|task|spaces)(\/|$)/.test(path) || path.startsWith('/plugins/tasks/'), component: TasksScreen }],
        Provider: TaskDragging, Sidebar: TasksSidebar, Settings: SpaceSettings, ConversationActions: TaskActions, ConversationBadge: TaskBadge, Conflicts: TaskConflicts,
        filter: { id: 'linked', label: 'Show linked conversations', hiddenMessage:'Turn on “Show linked conversations” to include them.', visible: (c, records, contexts) => !conversationTaskId(c, ((records.state || emptySnapshot()) as Snapshot).tasks.map(t => ({ ...t, link: contexts.find(v => v.id === t.contextId)?.link || t.link }))) },
        swipe: {canRunOffline:c=>!!linkedTaskId(c), label: c => linkedTaskId(c) ? 'Open task' : 'Make task', async run(c) { const existing=linkedTaskId(c);if (existing) {
                location.hash = `#/task/${existing}`;
                return;
            } const id = await createTaskFromConversation(c.key, c.title.slice(0, 2000)); return { text: `Task created in ${taskInboxName(id)}.`, route: `/task/${id}` }; } },
        shares: [{ id: 'capture', title: 'Tasks', accepts: c => !!(c.title || c.text || c.url), path: '/plugins/tasks/share' }],
        reduce(records, op) { const state = (records.state || emptySnapshot()) as Snapshot; if (op.command === 'space')
            return { ...records, state: applySpaceOp(state, op.input as any, false) }; if (op.command === 'task')
            return { ...records, state: applyTaskOp(state, op.input as any, false) }; return records; },
        start() { void initialiseTasks(); },
    };
}
