import { describe, expect, it } from 'vitest';
import { activitySummary, groupHistory } from '../src/historyGroups';
import type { ChatMessage, History } from '../shared/model';

const page = (messages: ChatMessage[], offset = 0): History => ({ sessionId: 'chat', order: 'latest', offset, messages, hasMore: false, fetchedAt: 0 });
const call = (id: number, content = ''): ChatMessage => ({ id, role: 'assistant', content, tool_calls: [{ function: { name: 'terminal', arguments: '{}' } }] });
const output = (id: number): ChatMessage => ({ id, role: 'tool', content: `Result ${id}` });

describe('conversation activity groups', () => {
  it('groups model-facing background results with tools without changing the source messages', () => {
    const completion: ChatMessage = { id: 3, role: 'user', display_kind: 'async_delegation_complete', content: '[ASYNC DELEGATION BATCH COMPLETE — fixture]\nFull review result.' };
    const process: ChatMessage = { id: 4, role: 'user', display_kind: 'process_complete', content: 'Process exited with code 1.' };
    const groups = groupHistory([page([call(1), output(2), completion, process, {id:5,role:'assistant',content:'Here is my answer.'}])]);
    expect(groups.map(group => group.kind)).toEqual(['activity', 'message']);
    expect(groups[0]).toMatchObject({kind:'activity', calls:1, results:2, entries:[{message:{id:1}}, {message:{id:2}}, {message:completion}, {message:process}]});
    if (groups[0].kind !== 'activity') throw new Error('Missing activity');
    expect(activitySummary(groups[0])).toBe('1 tool call · 2 background results');
    expect(groups[0].entries[2].message).toBe(completion);
    expect(completion.role).toBe('user');
  });
  it('keeps standalone background results discoverable and stable across history updates', () => {
    const completion: ChatMessage = {id:2,role:'user',display_kind:'async_delegation_complete',content:'Review results'};
    const before = groupHistory([page([completion])]);
    const after = groupHistory([page([call(1)], 200), page([completion, output(3)])], before);
    expect(after).toHaveLength(1);
    expect(after[0].key).toBe(before[0].key);
    if (before[0].kind !== 'activity') throw new Error('Missing activity');
    expect(activitySummary(before[0])).toBe('1 background result');
  });
  it('keeps genuine user messages visible even when they quote a completion notice', () => {
    const text = '[ASYNC DELEGATION BATCH COMPLETE — fixture]\nWhat does this mean?';
    const groups = groupHistory([page([{id:1,role:'user',content:text}, {id:2,role:'user',display_kind:'steer',content:text}])]);
    expect(groups.map(group => group.kind)).toEqual(['message', 'message']);
  });
  it('collapses successive tool rounds together, including blank assistant rows and empty outputs', () => {
    const groups = groupHistory([page([call(1), output(2), {role:'assistant',content:''}, call(3, ' \n'), {id:4,role:'tool',content:''}])]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: 'activity', calls: 2, entries: [{message:{id:1}}, {message:{id:2}}, {message:{id:3}}, {message:{id:4}}] });
  });
  it('keeps an activity disclosure stable as new tool rounds arrive', () => {
    const before = groupHistory([page([call(1), output(2)])]);
    const after = groupHistory([page([call(1), output(2), call(3), output(4)])], before);
    expect(after[0].key).toBe(before[0].key); expect(after[0]).toMatchObject({ kind: 'activity', calls: 2 });
  });
  it('uses distinct group keys if newly available commentary splits a tool run', () => {
    const before = groupHistory([page([call(1), output(2), call(3), output(4)])]);
    const after = groupHistory([page([call(1), output(2), call(3, 'A progress update.'), output(4)])], before);
    expect(new Set(after.map(group => group.key)).size).toBe(after.length);
  });
  it('keeps spoken assistant content and user messages visible between runs', () => {
    const groups = groupHistory([page([call(1), output(2), call(3, 'I will check one more thing.'), output(4), {id:5,role:'user',content:'Please continue.'}, call(6), output(7)])]);
    expect(groups.map(group => group.kind)).toEqual(['activity','message','activity','message','activity']);
    expect(groups[1]).toMatchObject({entry:{message:{content:'I will check one more thing.'}}});
  });
  it('uses visible display content and keeps attachments outside activity groups', () => {
    const groups = groupHistory([page([
      {...call(1, 'Internal representation'), display_content: ''}, output(2),
      {...call(3), display_content: 'A visible update'},
      {...call(4), display_content: '', content: [{type:'image_url',image_url:{url:'/tmp/result.png'}}]},
      output(5)
    ])]);
    expect(groups.map(group => group.kind)).toEqual(['activity','message','message','activity']);
  });
  it('combines pages without changing the group identity or original media coordinates', () => {
    const recent = page([output(2), call(3), output(4)]), older = page([call(1)], 200);
    const before = groupHistory([recent]), after = groupHistory([older, recent]);
    expect(after).toHaveLength(1); expect(after[0].key).toBe(before[0].key);
    expect(after[0]).toMatchObject({kind:'activity',calls:2,entries:[{page:older,index:0},{page:recent,index:0},{page:recent,index:1},{page:recent,index:2}]});
  });
});
