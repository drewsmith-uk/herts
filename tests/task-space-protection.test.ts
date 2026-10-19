import { describe, expect, it } from 'vitest';
import { applySpaceOp, applyTaskOp, emptySnapshot, originalSpaceId, withSpaces } from '../plugins/tasks/src/model';
const second = '00000000-0000-4000-8000-000000000002';
const operation = (spaceId: string, kind: 'create' | 'default' | 'delete') => ({id:crypto.randomUUID(),spaceId,kind,at:1,name:'Work',baseName:'Personal',baseDefaultSpaceId:originalSpaceId});
describe('default space deletion protection', () => {
  it('protects the default even when an older client requests its deletion', () => {
    expect(()=>applySpaceOp(emptySnapshot(), operation(originalSpaceId,'delete'))).toThrow('Choose another default');
    expect(()=>applySpaceOp(emptySnapshot(), operation(originalSpaceId,'delete'),false)).toThrow('Choose another default');
  });
  it('deletes the empty original after selecting another default and preserves normalized lists', () => {
    let state=applySpaceOp(emptySnapshot(),operation(second,'create'));
    state=applySpaceOp(state,operation(second,'default'));
    state=applySpaceOp(state,operation(originalSpaceId,'delete'));
    const restored=withSpaces(JSON.parse(JSON.stringify(state)));
    expect(restored.spaces.map(s=>s.id)).toEqual([second]);
    expect(restored.defaultSpaceId).toBe(second);
    expect(restored.lists).toEqual(restored.spaceLists[second]);
    expect(()=>applyTaskOp(restored,{id:crypto.randomUUID(),taskId:crypto.randomUUID(),kind:'create',title:'Old offline capture',at:2})).toThrow('space is not available');
    expect(applyTaskOp(restored,{id:crypto.randomUUID(),taskId:crypto.randomUUID(),spaceId:second,kind:'create',title:'New capture',at:2}).tasks[0].spaceId).toBe(second);
  });
  it('rejects an offline deletion after another device makes its target default', () => {
    let state=applySpaceOp(emptySnapshot(),operation(second,'create'));
    const stale={...operation(second,'delete'),baseName:'Work'};
    state=applySpaceOp(state,operation(second,'default'));
    expect(()=>applySpaceOp(state,stale)).toThrow('Choose another default');
  });
  it('still protects completed content in a non-default original space', () => {
    let state=applySpaceOp(emptySnapshot(),operation(second,'create'));
    state=applyTaskOp(state,{id:crypto.randomUUID(),taskId:crypto.randomUUID(),kind:'create',title:'Retain me',at:2});
    state=applyTaskOp(state,{id:crypto.randomUUID(),taskId:state.tasks[0].id,kind:'move',status:'done',baseStatus:'inbox',spaceId:originalSpaceId,baseSpaceId:originalSpaceId,at:3});
    state=applySpaceOp(state,operation(second,'default'));
    expect(()=>applySpaceOp(state,operation(originalSpaceId,'delete'))).toThrow('Move all tasks');
  });
});
