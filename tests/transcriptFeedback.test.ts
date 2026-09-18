import { describe, expect, it } from 'vitest';
import { outgoingInHistory, outgoingStatus, type OutgoingMessage } from '../src/transcriptFeedback';
import type { Action, History } from '../shared/model';
const outgoing: OutgoingMessage = { id:'send',taskId:'context',text:'Do it again',uploadIds:[],at:1_800_000_000_000,baseline:{sessionId:'chat',ids:[1,2]} };
const page = (messages:History['messages']):History => ({sessionId:'chat',order:'latest',offset:0,hasMore:false,fetchedAt:outgoing.at+100,messages});
describe('submitted transcript feedback',()=>{
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
