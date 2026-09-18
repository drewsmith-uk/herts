import { describe, expect, it } from 'vitest';
import { groupHistory } from '../src/historyGroups';
import type { ChatMessage, History } from '../shared/model';

const page = (messages: ChatMessage[], offset = 0): History => ({ sessionId: 'chat', order: 'latest', offset, messages, hasMore: false, fetchedAt: 0 });
const call = (id: number, content = ''): ChatMessage => ({ id, role: 'assistant', content, tool_calls: [{ function: { name: 'terminal', arguments: '{}' } }] });
const output = (id: number): ChatMessage => ({ id, role: 'tool', content: `Result ${id}` });

describe('conversation activity groups', () => {
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
