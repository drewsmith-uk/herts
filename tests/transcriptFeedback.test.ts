import { liveReplyReplacement } from '../src/transcriptFeedback';
import { describe, expect, it } from 'vitest';
import { historyBaseline, outgoingInHistory, outgoingStatus, type OutgoingMessage } from '../src/transcriptFeedback';
import type { Action, History } from '../shared/model';
const outgoing: OutgoingMessage = { id:'send',taskId:'context',text:'Do it again',uploadIds:[],at:1_800_000_000_000,baseline:{sessionId:'chat',ids:[1,2]} };
const page = (messages:History['messages']):History => ({sessionId:'chat',order:'latest',offset:0,hasMore:false,fetchedAt:outgoing.at+100,messages});
describe('submitted transcript feedback',()=>{
  it('treats incomplete saved history as unknown, so an earlier retry cannot confirm a new one',()=>{
    for (const saved of [undefined, null, {}, { sessionId: 'chat' }, { ...page([]), messages: null }, { ...page([]), messages: [null] }]) {
      const baseline = historyBaseline(saved);
      expect(baseline).toBeUndefined();
      expect(outgoingInHistory({ ...outgoing, baseline }, [page([{ id: 1, role: 'user', content: outgoing.text, timestamp: (outgoing.at - 60000) / 1000 }])])).toBe(false);
    }
    expect(historyBaseline(page([]))).toEqual({ sessionId: 'chat', ids: [] });
    expect(historyBaseline(page([{ id: 1, role: 'user' }, { id: 'two', role: 'assistant' }, { role: 'tool' }]))).toEqual({ sessionId: 'chat', ids: [1, 'two'] });
  });
  it('does not treat an injected background result as confirmation of a user submission',()=>{
    for (const display_kind of ['async_delegation_complete', 'process_complete']) {
      expect(outgoingInHistory(outgoing,[page([{id:3,role:'user',display_kind,content:outgoing.text}])])).toBe(false);
    }
  });
  it('does not mistake an old identical message for the new submission',()=>{
    expect(outgoingInHistory(outgoing,[page([{id:1,role:'user',content:outgoing.text}])])).toBe(false);
    expect(outgoingInHistory(outgoing,[{...page([{id:0,role:'user',content:outgoing.text}]),offset:200}])).toBe(false);
    expect(outgoingInHistory(outgoing,[page([{id:3,role:'user',content:outgoing.text}])])).toBe(true);
  });
  it('matches persisted attachment references without treating another prompt as a match',()=>{
    const attached={...outgoing,uploadIds:['upload']};
    expect(outgoingInHistory(attached,[page([{id:3,role:'user',content:'Do it again\n@file:/tmp/note.txt'}])])).toBe(true);
    expect(outgoingInHistory(attached,[page([{id:3,role:'user',content:'Do it again tomorrow'}])])).toBe(false);
  });
  it('uses persisted timestamps for other-device submissions and rotated conversations',()=>{
    const fresh={...outgoing,baseline:undefined};
    expect(outgoingInHistory(fresh,[page([{id:3,role:'user',content:outgoing.text,timestamp:(outgoing.at-60000)/1000}])])).toBe(false);
    expect(outgoingInHistory(fresh,[page([{id:4,role:'user',content:outgoing.text,timestamp:outgoing.at/1000}])])).toBe(true);
    expect(outgoingInHistory(outgoing,[{...page([{id:4,role:'user',content:outgoing.text,timestamp:outgoing.at/1000}]),sessionId:'rotated'}])).toBe(true);
  });
  it('distinguishes preparation, accepted, queued, rejected and uncertain submissions',()=>{
    const action=(patch:Partial<Action>)=>patch as Action;
    expect(outgoingStatus()).toContain('Awaiting');
    expect(outgoingStatus(action({sendStage:'preparing',receipt:'pending'}))).toBe('Saved · preparing conversation');
    expect(outgoingStatus(action({sendStage:'preparing',receipt:'unknown'}))).toBe('Not sent');
    expect(outgoingStatus(action({sendStage:'submitted',receipt:'accepted'}))).toBe('Sent to Hermes');
    expect(outgoingStatus(action({sendStage:'submitted',receipt:'accepted',awaitingTurn:true}))).toBe('Queued for Hermes');
    expect(outgoingStatus(action({sendStage:'submitting',receipt:'unknown'}))).toBe('Submission unconfirmed');
    expect(outgoingStatus(action({sendStage:'submitting',receipt:'rejected'}))).toBe('Not sent');
  });
});

it('replaces only the current turn partial reply while live text catches up', () => {
  const outgoing = { id: 'send', taskId: 'context', text: 'Question', uploadIds: [], at: 2000, baseline: { sessionId: 'chat', ids: [1] } };
  const pages: History[] = [{ sessionId: 'chat', offset: 0, hasMore: false, fetchedAt: 3000, messages: [{ id: 1, role: 'assistant', content: 'Old reply' }, { id: 2, role: 'user', content: 'Question' }, { id: 3, role: 'assistant', content: 'New' }] }];
  expect(liveReplyReplacement(pages, 'New complete reply', outgoing)).toBe('chat:3');
  expect(liveReplyReplacement(pages, 'Different reply', outgoing)).toBeUndefined();
  expect(liveReplyReplacement(pages, 'Old reply extended', { ...outgoing, text: 'Other question' })).toBeUndefined();
});
