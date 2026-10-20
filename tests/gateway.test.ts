import { describe, expect, it, vi } from 'vitest';
import { Gateway, isPersonal } from '../server/gateway';
import { mediaRefs, localMediaPath } from '../shared/media';
import { messageText } from '../shared/model';
describe('Desktop history and personal conversation projection', () => {
  it('refreshes list metadata immediately while sharing concurrent reads', async () => {
    const gateway = new Gateway('', '');
    const old = { id: 'existing', source: 'desktop', title: 'Old title', preview: 'Old preview' };
    const http = vi.spyOn(gateway, 'http').mockResolvedValue({ sessions: [old], total: 1 });
    expect((await gateway.search(''))[0].title).toBe('Old title');
    let resolve!: (value: any) => void;
    http.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const first = gateway.search(''), second = gateway.search('');
    resolve({ sessions: [{ ...old, title: 'New title', preview: 'New preview' }, { id: 'new', source: 'desktop', title: 'New conversation' }], total: 2 });
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(a.map(row => row.title)).toEqual(['New title', 'New conversation']);
    expect(a[0].preview).toBe('New preview');
    expect(http).toHaveBeenCalledTimes(2);
    http.mockRejectedValueOnce(new Error('Unavailable'));
    await expect(gateway.search('')).rejects.toThrow('Unavailable');
    http.mockResolvedValueOnce({ sessions: [], total: 0 });
    expect(await gateway.search('')).toEqual([]);
  });
  it('never forwards credentials through redirects or exposes a malformed response body', async () => {
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('fixture-private-response-is-not-json',{status:200}));
    try {
      const gateway=new Gateway('https://backend.example.com','fixture-token');
      await expect(gateway.http('/api/sessions')).rejects.toThrow('Hermes returned an invalid response.');
      expect(fetch).toHaveBeenCalledWith(new URL('https://backend.example.com/api/sessions'),expect.objectContaining({redirect:'error'}));
      await expect(gateway.http('/api/audio/speak',{text:'Fixture'})).rejects.toMatchObject({uncertain:true});
    } finally { fetch.mockRestore(); }
  });

  it('explains speech provider failures without exposing provider URLs or credentials', async () => {
    const fetch=vi.spyOn(globalThis,'fetch');
    try {
      const gateway=new Gateway('https://backend.example.com','fixture-token');
      fetch.mockResolvedValueOnce(new Response(JSON.stringify({detail:'TTS generation failed (edge): 403, url=wss://provider.example/?token=fixture-secret'}),{status:400}));
      await expect(gateway.http('/api/audio/speak?profile=frontend-eng',{text:'Fixture'})).rejects.toMatchObject({message:'Edge speech is unavailable for this profile. Select another speech provider in Hermes.',uncertain:false,code:400});
      fetch.mockResolvedValueOnce(new Response(JSON.stringify({detail:'API key fixture-secret is invalid'}),{status:400}));
      await expect(gateway.http('/api/audio/speak',{text:'Fixture'})).rejects.toThrow('Speech credentials are missing or invalid for this profile.');
      fetch.mockResolvedValueOnce(new Response(JSON.stringify({detail:'Unexpected private provider detail'}),{status:500}));
      await expect(gateway.http('/api/audio/speak',{text:'Fixture'})).rejects.toMatchObject({message:'Hermes could not prepare audio for this profile (500). Check its speech settings in Hermes.',uncertain:true});
    } finally {fetch.mockRestore();}
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

it('recognises MEDIA markers, quoted paths, and duplicate references', () => {
  const content = 'MEDIA:/tmp/report.html\nMEDIA: "/tmp/report with spaces.html"\nMEDIA:\'/tmp/notes.pdf\'\nMEDIA:`/tmp/chart.png`\n@file:/tmp/report.html\nMEDIA:https://example.com/private\nMEDIA:javascript:alert(1)';
  expect(mediaRefs({ role: 'assistant', content }).map(ref => ref.path)).toEqual([
    '/tmp/report.html', '/tmp/report with spaces.html', '/tmp/notes.pdf', '/tmp/chart.png',
  ]);
});
