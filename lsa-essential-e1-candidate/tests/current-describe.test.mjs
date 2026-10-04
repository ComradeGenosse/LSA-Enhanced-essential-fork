import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { fixture } from './p2-fixtures.mjs';
import { startCharacterEditor } from '../src/characters/editorServer.mjs';
import { describeCurrent } from '../src/control/currentDescribe.mjs';

async function request(url,{method = 'GET',headers = {},body = ''} = {}) {
  return new Promise((resolve,reject) => { const req = http.request(url,{method,headers},response => { const chunks = []; response.on('data',chunk => chunks.push(chunk)); response.on('end',() => resolve({status:response.statusCode,body:Buffer.concat(chunks).toString('utf8')})); }); req.on('error',reject); req.end(body); });
}
// A session profile exactly as a dialogue turn creates it for the selected encounter.
function encounterSession(f,speechProfile = { voice:'nova' }) {
  const selected = f.native.selected;
  return f.service.session({ pedId:selected.pedId,sessionNonce:0 },{ pedId:selected.pedId,gender:'male',ageRange:'old',archetypeName:'Street vendor',integrations:{ characterProfile:{ encounterId:selected.encounterId } } },speechProfile);
}
const DISPLAY_KEYS = new Set(['kind','name','characterId','relationship','status','voice','facts']);

test('describe is read-only: an unknown encounter creates no session profile and reveals nothing',async t => {
  const f = await fixture(t),before = f.service.sessions.encounterIds();
  assert.deepEqual(describeCurrent(f.service,{ encounterId:f.native.selected.encounterId }),{ kind:'unknown',facts:[] });
  assert.deepEqual(describeCurrent(f.service,{}),{ kind:'unknown',facts:[] });
  assert.deepEqual(f.service.sessions.encounterIds(),before);
  assert.equal(f.service.sessions.peek(f.native.selected.encounterId),null);
  assert.equal(f.service.sessions.peek('not-a-uuid'),null);
  assert.equal(f.native.requests.length,0,'no native request, capture or ownership');
});

test('describe returns the session name, role and voice for an ordinary encounter',async t => {
  const f = await fixture(t),session = encounterSession(f);
  const described = describeCurrent(f.service,{ encounterId:f.native.selected.encounterId });
  assert.deepEqual(described,{ kind:'encounter',name:session.name,voice:'nova',facts:['Street vendor'] });
  assert.equal(describeCurrent(f.service,{ encounterId:randomUUID() }).kind,'unknown');
});

test('describe returns display fields only for a promoted character, matched by owner alias',async t => {
  const f = await fixture(t);
  const promoted = await f.service.promote();
  await f.service.edit(promoted.characterId,{ biography:'Private biography',playerNotes:'Private notes',relationship:{ state:'friend',description:'Private relationship notes' } },1);
  await f.service.memory(promoted.characterId,'create',{ patch:{ text:'Private memory',selectedForContext:true },expectedRevision:2 });
  const described = describeCurrent(f.service,{ encounterId:f.native.selected.encounterId,ownerAlias:promoted.promotion.ownerAlias });
  assert.equal(described.kind,'promoted');
  assert.equal(described.name,promoted.name);
  assert.equal(described.characterId,promoted.characterId);
  assert.equal(described.relationship,'friend');
  assert.equal(described.status,'available');
  assert.deepEqual(described.facts,[]);
  assert.ok(Object.keys(described).every(key => DISPLAY_KEYS.has(key)),'no profile content beyond display fields');
  assert.doesNotMatch(JSON.stringify(described),/Private|appearance|memories|biography|playerNotes|ownerAlias/);
  // An alias with no profile falls back to the encounter, then to unknown.
  assert.equal(describeCurrent(f.service,{ ownerAlias:'promoted.' + randomUUID() }).kind,'unknown');
});

test('describe validates ids and bounds every returned string',async t => {
  const f = await fixture(t);
  for (const bad of [{ encounterId:'17' },{ encounterId:'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' },{ ownerAlias:'promoted.17' },{ ownerAlias:42 },{ encounterId:{} }])
    assert.throws(() => describeCurrent(f.service,bad),/invalid_editor_request/);
  const encounterId = randomUUID();
  const service = { ready:false,sessions:{ peek:id => id === encounterId ? { name:'x'.repeat(81),facts:['ok','bad\u0007fact','y'.repeat(121),'two','three'],speechProfile:{ voice:'v'.repeat(41) } } : null } };
  assert.deepEqual(describeCurrent(service,{ encounterId }),{ kind:'encounter',facts:['ok','two','three'] });
});

test('the editor API serves current_describe behind the same token, origin and size checks',async t => {
  const f = await fixture(t),editor = await startCharacterEditor(f.service,{ port:0 }); t.after(() => editor.close());
  const token = (await request(editor.url)).body.match(/const auth="([a-f0-9]{64})"/)[1];
  const headers = { origin:editor.url,'content-type':'application/json','x-lsa-editor':token };
  const call = async data => { const result = await request(editor.url + '/api',{ method:'POST',headers,body:JSON.stringify(data) }); return { status:result.status,json:JSON.parse(result.body) }; };
  assert.deepEqual(await call({ action:'current_describe' }),{ status:200,json:{ kind:'unknown',facts:[] } });
  const session = encounterSession(f);
  assert.deepEqual((await call({ action:'current_describe',encounterId:f.native.selected.encounterId,ownerAlias:null })).json,{ kind:'encounter',name:session.name,voice:'nova',facts:['Street vendor'] });
  assert.deepEqual(await call({ action:'current_describe',encounterId:'17' }),{ status:400,json:{ error:'invalid_editor_request' } });
  assert.equal((await request(editor.url + '/api',{ method:'POST',headers:{ ...headers,'x-lsa-editor':'0'.repeat(64) },body:'{"action":"current_describe"}' })).status,403);
  assert.equal((await request(editor.url + '/api',{ method:'POST',headers:{ ...headers,origin:'https://example.com' },body:'{"action":"current_describe"}' })).status,403);
});

test('promote and control_current refuse a different current NPC when the native client names one',async t => {
  const f = await fixture(t),seen = f.native.selected.encounterId;
  await assert.rejects(f.service.promote(randomUUID()),/target_changed/);
  assert.equal(f.store.list().length,0,'nothing promoted');
  assert.deepEqual(f.native.requests.map(request => request.operation),['capture'],'no registration after a changed target');
  const promoted = await f.service.promote(seen);
  assert.equal(promoted.promotion.ownerAlias.startsWith('promoted.'),true);
  const before = f.native.requests.length;
  await assert.rejects(f.service.controlCurrent('follow',randomUUID()),/target_changed/);
  assert.deepEqual(f.native.requests.slice(before).map(request => request.operation),['capture'],'no follow sent for a changed target');
  assert.deepEqual(await f.service.controlCurrent('follow',seen),{ status:'follow' });
  assert.deepEqual(await f.service.controlCurrent('wait'),{ status:'wait' },'console and editor callers without an expectation are unchanged');
});

test('the editor API validates the expected encounter and reports target_changed',async t => {
  const f = await fixture(t),editor = await startCharacterEditor(f.service,{ port:0 }); t.after(() => editor.close());
  const token = (await request(editor.url)).body.match(/const auth="([a-f0-9]{64})"/)[1];
  const call = async data => { const result = await request(editor.url + '/api',{ method:'POST',headers:{ origin:editor.url,'content-type':'application/json','x-lsa-editor':token },body:JSON.stringify(data) }); return { status:result.status,json:JSON.parse(result.body) }; };
  assert.deepEqual(await call({ action:'promote',expectedEncounterId:'17' }),{ status:400,json:{ error:'invalid_editor_request' } });
  assert.deepEqual(await call({ action:'promote',expectedEncounterId:randomUUID() }),{ status:400,json:{ error:'target_changed' } });
  assert.equal((await call({ action:'promote',expectedEncounterId:f.native.selected.encounterId })).status,200);
  assert.deepEqual(await call({ action:'control_current',operation:'follow',expectedEncounterId:randomUUID() }),{ status:400,json:{ error:'target_changed' } });
  assert.equal((await call({ action:'control_current',operation:'follow',expectedEncounterId:f.native.selected.encounterId })).status,200);
  assert.equal((await call({ action:'control_current',operation:'wait' })).status,200);
});
