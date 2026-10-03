import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net, { Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fixture } from './p2-fixtures.mjs';
import { startCharacterEditor } from '../src/characters/editorServer.mjs';
import { NativeOwnerClient } from '../src/characters/nativeOwnerClient.mjs';
import { normalizeConfig } from '../src/config/e1Config.mjs';
const acorn = createRequire(import.meta.url)('../tools/vendor/acorn');
async function request(url,{method = 'GET',headers = {},body = ''} = {}) {
  return new Promise((resolve,reject) => { const req = http.request(url,{method,headers},response => { const chunks = []; response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks).toString('utf8')})); });req.on('error',reject);req.end(body); });
}
async function editor(t) {
  const f = await fixture(t),editor = await startCharacterEditor(f.service,{port:0});t.after(()=>editor.close());
  const response = await request(editor.url),token = response.body.match(/const auth="([a-f0-9]{64})"/)[1];
  const call = async data => { const result = await request(editor.url + '/api',{method:'POST',headers:{origin:editor.url,'content-type':'application/json','x-lsa-editor':token},body:JSON.stringify(data)});return {...result,json:JSON.parse(result.body)}; };
  return {...f,editor,response,token,call};
}
test('local editor loads usable profile/memory controls and syntactically valid browser code',async t => {
  const f = await editor(t);assert.equal(f.response.status,200);assert.equal(f.response.headers['cache-control'],'no-store');assert.equal(f.response.headers['x-frame-options'],'DENY');
  const script = f.response.body.match(/<script>([\s\S]*?)<\/script>/)[1];assert.doesNotThrow(()=>acorn.parse(script,{ecmaVersion:'latest'}));
  for (const control of ['Promote current NPC','Save profile','Add memory','Unpromote and delete profile','summon','follow','wait','dismiss','despawn']) assert.ok(f.response.body.includes(control));
});
test('editor supports explicit promote, list, edit, memory CRUD and character controls end to end',async t => {
  const f = await editor(t),promoted = await f.call({action:'promote'}),p = promoted.json;assert.equal(promoted.status,200);
  const listed = await f.call({action:'list'});assert.equal(listed.json[0].runtimeStatus,'spawned');
  const edited = await f.call({action:'edit',characterId:p.characterId,expectedRevision:1,patch:{name:'Chris',playerNotes:'<script>private</script>'}});assert.equal(edited.json.name,'Chris');
  const created = await f.call({action:'memory',characterId:p.characterId,operation:'create',expectedRevision:2,patch:{text:'Meet at the park',selectedForContext:true}});assert.equal(created.status,200);
  const deleted = await f.call({action:'memory',characterId:p.characterId,operation:'delete',memoryId:created.json.memoryId,expectedRevision:3});assert.equal(deleted.status,200);assert.deepEqual(deleted.json.profile.memories,[]);
  assert.equal((await f.call({action:'control',characterId:p.characterId,operation:'wait'})).status,200);
  assert.equal((await f.call({action:'control_current',operation:'follow'})).status,200);
  assert.equal((await f.call({action:'remove',characterId:p.characterId,confirmation:'yes',expectedRevision:4})).status,400);
  assert.equal((await f.call({action:'remove',characterId:p.characterId,confirmation:p.characterId,expectedRevision:4})).status,200);
});
test('editor blocks cross-origin, missing-token, DNS-rebinding, non-JSON and oversized writes',async t => {
  const f = await editor(t),headers = {origin:f.editor.url,'content-type':'application/json','x-lsa-editor':f.token};
  for (const patch of [{origin:'https://example.com'},{'x-lsa-editor':''},{'x-lsa-editor':'é'.repeat(64)},{host:'evil.example'},{'content-type':'text/plain'}]) assert.equal((await request(f.editor.url+'/api',{method:'POST',headers:{...headers,...patch},body:'{"action":"promote"}'})).status,403);
  assert.equal((await request(f.editor.url+'/api',{method:'POST',headers,body:'x'.repeat(17000)})).status,413);assert.equal(f.store.list().length,0);
});
test('editor exposes only bounded error codes and prevents structural ownership edits',async t => {
  const f = await editor(t),p = (await f.call({action:'promote'})).json;
  assert.deepEqual((await f.call({action:'edit',characterId:p.characterId,expectedRevision:1,patch:{characterId:'PRIVATE ID'}})).json,{error:'invalid_profile_edit'});
  assert.deepEqual((await f.call({action:'unknown'})).json,{error:'invalid_editor_action'});
});
test('native client refuses unsupported or oversized operations before opening a pipe',async () => {
  const client = new NativeOwnerClient({pipeName:'test',worldProfileId:'11111111-1111-4111-8111-111111111111'});
  await assert.rejects(client.request('audio'),/invalid_owner_operation/);await assert.rejects(client.request('spawn',{payload:'x'.repeat(17000)}),/owner_request_limit/);
});
test('native spawn request remains pending beyond three seconds and keeps one fixed expiry', async t => {
  const ownerEpoch='22222222-2222-4222-8222-222222222222',worldProfileId='11111111-1111-4111-8111-111111111111'; let frame;
  const originalConnect=net.createConnection;const socket=new Socket();
  net.createConnection=()=>socket;t.after(()=>{net.createConnection=originalConnect;socket.destroy();});
  socket.write=bytes=>{frame=JSON.parse(String(bytes).trim());setTimeout(()=>socket.emit('data',Buffer.from(JSON.stringify({version:1,requestId:frame.requestId,status:'ok',result:{status:'spawned'},reason:null})+'\n')),3200);return true;};
  const client=new NativeOwnerClient({pipeName:'test',worldProfileId,summonWaitMs:5000});const started=Date.now();
  const resultPromise=client.request('spawn',{});
  process.nextTick(()=>socket.emit('data',Buffer.from(JSON.stringify({version:1,type:'hello',worldProfileId,ownerEpoch})+'\n')));
  const result=await resultPromise;
  assert.deepEqual(result,{status:'spawned'});assert.ok(Date.now()-started>3000);assert.ok(frame.expiresAtUtc>=started+4500&&frame.expiresAtUtc<=started+5100);
});
test('native spawn disconnect after its fixed deadline reports the summon timeout', async t => {
  const ownerEpoch='22222222-2222-4222-8222-222222222222',worldProfileId='11111111-1111-4111-8111-111111111111';
  const originalConnect=net.createConnection;const socket=new Socket();net.createConnection=()=>socket;t.after(()=>{net.createConnection=originalConnect;socket.destroy();});
  socket.write=()=>true;
  const client=new NativeOwnerClient({pipeName:'test',worldProfileId,summonWaitMs:5000});
  const result=client.request('spawn',{});process.nextTick(()=>socket.emit('data',Buffer.from(JSON.stringify({version:1,type:'hello',worldProfileId,ownerEpoch})+'\n')));
  setTimeout(()=>socket.emit('close'),5100);
  await assert.rejects(result,/summon_wait_timeout/);
});
test('optional P2 configuration defaults off and validates bounded editor/pipe settings',() => {
  assert.equal(normalizeConfig({},{}).promotedCharacters.enabled,false);
  assert.equal(normalizeConfig({},{}).promotedCharacters.summonWaitMs,30000);
  for (const promotedCharacters of [{enabled:'true'},{editorPort:80},{pipeName:'../bad'},{storePath:''},{unknown:true},{summonWaitMs:60001},{summonWaitMs:4999}]) assert.throws(()=>normalizeConfig({promotedCharacters},{}));
});
