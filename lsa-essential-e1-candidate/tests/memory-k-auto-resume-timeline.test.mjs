import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createP2MemoryStorage} from '../../lsa-shared-brain/src/characters/sqliteProfileStore.mjs';
import {createConversationJournalRecorder} from '../../lsa-shared-brain/src/memory/conversationRecorder.mjs';
import {bindHostContext} from '../src/characters/timelineAutoResume.mjs';
import {normalizeMemoryKConfig} from '../src/memory/capabilityPolicy.mjs';
import {profile} from './p2-fixtures.mjs';
import {worldProfileId} from './identity-fixtures.mjs';

const host=(epoch=1)=>({hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:epoch});
const identity=n=>({pedId:101,turnId:n,generationId:'g1',sessionNonce:'test-session'});
const open=filePath=>createP2MemoryStorage({filePath,worldProfileId,sourceRequired:true});
async function dir(t){
  const d=await fs.mkdtemp(path.join(os.tmpdir(),'auto-resume-'));
  // t.after hooks run in registration order. On Windows, deleting p2.sqlite
  // before a later store.close() fails with EBUSY. Own both in this hook.
  const stores=[];
  t.after(async()=>{
    for(const store of stores.reverse())await store.close();
    await fs.rm(d,{recursive:true,force:true});
  });
  return {filePath:path.join(d,'p2.sqlite'),track:store=>{stores.push(store);return store;}};

}
// First GTA launch: the player confirms the one timeline manually and talks to Nathan.
async function firstLaunch(filePath){
  const store=open(filePath);
  await store.initialize();
  const p=await store.create(profile());
  const timelineId=await store.createTimeline({label:'Main save'});
  store.setVerifiedHostContext(host());
  await store.confirmTimeline(timelineId);
  await createConversationJournalRecorder(store).recordPlayerAccepted({
    characterId:p.characterId,identity:identity('one'),source:'typed',
    text:'Remember that I hate olives',attribution:{protagonist:'franklin'}});
  await store.close();
  return {characterId:p.characterId,timelineId};
}

test('auto-resume restores the selected timeline after restart and keeps existing memories',async t=>{
  const {filePath,track}=await dir(t),first=await firstLaunch(filePath);
  const store=track(open(filePath));
  await store.initialize();
  const second=host();
  // Without the flag-driven resume a new launch still needs the editor.
  store.setVerifiedHostContext(second);
  assert.equal(store.timelineWritable,false);
  assert.equal(store.timelinePendingReason,'native_source_confirmation_required');
  assert.deepEqual(await store.resumeSelectedTimeline(second),{resumed:true,timelineId:first.timelineId});
  assert.equal(store.timelineWritable,true);
  assert.equal(store.timelineSelectionConfirmed,true);
  assert.equal(store.activeTimelineId,first.timelineId);
  // Prior memory is readable and new memory lands on the same timeline.
  const lines=await store.readDialogueLines({characterId:first.characterId,timelineId:first.timelineId});
  assert.ok(lines.some(line=>JSON.stringify(line).includes('hate olives')));
  await createConversationJournalRecorder(store).recordPlayerAccepted({
    characterId:first.characterId,identity:identity('two'),source:'typed',
    text:'Remember that I love tacos',attribution:{protagonist:'franklin'}});
  const after=await store.readDialogueLines({characterId:first.characterId,timelineId:first.timelineId});
  assert.equal(after.length,lines.length+1);
  // Repeating the same authenticated context is a no-op, not a new revocation.
  const generation=store.memoryAuthorityFence;
  assert.equal((await store.resumeSelectedTimeline(second)).reason,'already_confirmed');
  assert.equal(store.memoryAuthorityFence,generation);
});

test('bindHostContext resumes only when the flag is true; default stays manual',async t=>{
  const {filePath,track}=await dir(t),first=await firstLaunch(filePath);
  const store=track(open(filePath));
  await store.initialize();
  for(const autoResume of [undefined,false]){
    assert.equal(await bindHostContext(store,host(),{autoResume}),null);
    assert.equal(store.timelineWritable,false);
    assert.equal(store.timelineSelectionConfirmed,false);
  }
  const result=await bindHostContext(store,host(),{autoResume:true});
  assert.equal(result.resumed,true);
  assert.equal(store.activeTimelineId,first.timelineId);
  assert.equal(store.timelineWritable,true);
  // A null context (native disconnect) never resumes anything.
  assert.equal(await bindHostContext(store,null,{autoResume:true}),null);
  assert.equal(store.timelineWritable,false);
  // memoryK config: absent by default, boolean only.
  assert.equal('autoResumeSingleTimeline' in normalizeMemoryKConfig({}),false);
  assert.equal(normalizeMemoryKConfig({autoResumeSingleTimeline:true}).autoResumeSingleTimeline,true);
  assert.throws(()=>normalizeMemoryKConfig({autoResumeSingleTimeline:'yes'}),/must be boolean/);
});

test('native disconnect, reset or ambiguity before resume lands prevents resume and stale writes',async t=>{
  const {filePath,track}=await dir(t),first=await firstLaunch(filePath);
  const store=track(open(filePath));
  await store.initialize();
  // Disconnect racing a queued resume: nothing becomes writable.
  const a=host();
  const racing=bindHostContext(store,a,{autoResume:true});
  store.setVerifiedHostContext(null);
  assert.equal((await racing).reason,'timeline_write_suspended');
  assert.equal(store.timelineWritable,false);
  // An ambiguous boundary racing the resume (same tick as the new epoch) wins.
  const b=host();
  const ambiguous=bindHostContext(store,b,{autoResume:true});
  store.onBoundary({reason:'clock_regression'});
  assert.equal((await ambiguous).reason,'timeline_write_suspended');
  assert.equal(store.timelineWritable,false);
  // ...and it stays manual on later launches until a human confirms.
  assert.equal((await bindHostContext(store,host(),{autoResume:true})).reason,'clock_regression');
  assert.equal(store.timelineWritable,false);
  await store.confirmTimeline(first.timelineId);
  assert.equal(store.timelineWritable,true);
  // After a successful resume, a later disconnect/reset kills queued old work.
  const c=host();
  store.setVerifiedHostContext(null);
  assert.equal((await bindHostContext(store,c,{autoResume:true})).resumed,true);
  let written=0;
  const stale=store.withTimelineWrite(first.timelineId,()=>++written);
  store.setVerifiedHostContext(null);
  await assert.rejects(stale,/timeline_write_suspended/);
  assert.equal(written,0);
  // A resume for a context that is no longer current is refused.
  assert.equal((await store.resumeSelectedTimeline(c)).reason,'native_source_unavailable');
});

test('no timeline, several timelines or an unselected one keep manual confirmation',async t=>{
  const {filePath,track}=await dir(t);
  const store=track(open(filePath));
  await store.initialize();
  const h=host();
  store.setVerifiedHostContext(h);
  assert.equal((await store.resumeSelectedTimeline(h)).reason,'no_timeline');
  const one=await store.createTimeline({label:'Main'});
  assert.equal((await store.resumeSelectedTimeline(h)).reason,'no_selected_timeline',
    'creating a timeline never activates it');
  await store.confirmTimeline(one);
  await store.createTimeline({label:'Second'});
  store.setVerifiedHostContext(null);
  const next=host();
  store.setVerifiedHostContext(next);
  assert.equal((await store.resumeSelectedTimeline(next)).reason,'multiple_timelines');
  assert.equal(store.timelineWritable,false);
});
