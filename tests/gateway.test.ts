import { describe, expect, it, vi } from 'vitest';
import { Gateway, isPersonal } from '../server/gateway';
import { mediaRefs, localMediaPath } from '../shared/media';
import { messageText } from '../shared/model';
describe('Desktop history and personal conversation projection', () => {
  it('never forwards credentials through redirects or exposes a malformed response body', async () => {
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('fixture-private-response-is-not-json',{status:200}));
    try {
      const gateway=new Gateway('https://backend.example.com','fixture-token');
      await expect(gateway.http('/api/sessions')).rejects.toThrow('Hermes returned an invalid response.');
      expect(fetch).toHaveBeenCalledWith(new URL('https://backend.example.com/api/sessions'),expect.objectContaining({redirect:'error'}));
      await expect(gateway.http('/api/audio/speak',{text:'Fixture'})).rejects.toMatchObject({uncertain:true});
    } finally { fetch.mockRestore(); }
  });

  it('filters worker/test sources, hidden rows and explicit lineage exclusions', () => {
    for (const row of [{source:'subagent'}, {source:'cron'}, {source:'desktop',hidden:true}, {source:'telegram',room_plumbing:true}, {source:'desktop',title:'Smoke test'}, {source:'telegram',title:'test'}]) expect(isPersonal(row)).toBe(false);
    expect(isPersonal({source:'desktop',id:'tip',_lineage_root_id:'root'}, ['root'])).toBe(false);
    expect(isPersonal({source:'telegram',title:'Plan a trip'})).toBe(true);
  });
  it('keeps compaction aliases together and actual branch roots separate', async () => {
    const g = new Gateway('', '');
    g.http = async () => ({sessions:[{id:'tip',_lineage_root_id:'root',_lineage_ids:['root','tip'],source:'desktop',title:'Notes'}, {id:'branch',source:'desktop',title:'Alternative'}], total:2});
    expect((await g.conversation('root')).aliases).toEqual(['root','tip']); expect((await g.conversations()).length).toBe(2);
  });
  it('retains pagination boundaries while hiding internal content and using display projections', async () => {
    const g = new Gateway('', ''); g.conversation = async () => ({id:'tip',key:'root',aliases:['root','tip'],title:'Notes',preview:'',source:'desktop',updatedAt:0});
    g.http = async () => ({session_id:'tip', profile:'default', messages:[{role:'system',display_kind:'marker',content:'private system text'}, {role:'user',display_kind:'hidden',content:'hidden seed'}, {role:'user',content:'compaction internals',display_content:'My original question'}], pagination:{returned:200}});
    const history = await g.history('root',200); expect(history.messages).toHaveLength(1); expect(messageText(history.messages[0])).toBe('My original question'); expect(history.hasMore).toBe(true); expect(history.offset).toBe(200);
  });
  it('recognises exact local attachment references without fetching remote URLs', () => {
    const refs = mediaRefs({role:'assistant',content:'@file:"/tmp/my file.pdf"\n![Image](/home/example/.hermes/images/photo.png)\n[website](https://example.com/file)'});
    expect(refs.map(r => r.path)).toEqual(['/tmp/my file.pdf','/home/example/.hermes/images/photo.png']); expect(refs[1].image).toBe(true);
    expect(localMediaPath('https://attacker.example/image')).toBeUndefined(); expect(localMediaPath('javascript:alert(1)')).toBeUndefined();
  });
  it('requests the latest window without reversing its chronological message order', async () => {
    const gateway = new Gateway('', '');
    gateway.conversation = async () => ({id:'tip',key:'root',aliases:['root','tip'],title:'Notes',preview:'',source:'desktop',updatedAt:0});
    let request = '';
    gateway.http = async path => { request = path; return {session_id:'tip',profile:'default',messages:[{id:251,role:'user',content:'Earlier in this page'},{id:450,role:'assistant',content:'Most recent'}],pagination:{returned:200}}; };
    const page = await gateway.history('root', 200, 'latest');
    expect(request).toContain('order=latest&limit=200&offset=200'); expect(page.order).toBe('latest'); expect(page.messages.map(m=>m.id)).toEqual([251,450]); expect(page.hasMore).toBe(true);
  });
});
