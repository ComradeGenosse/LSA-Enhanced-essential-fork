import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createRuntimeForBundle} from '../src/bootstrap.mjs';
import {MEMORY_K_CAPABILITIES} from '../src/memory/capabilityPolicy.mjs';
import {IDENTITY_DLL_SHA256,IDENTITY_METADATA_SHA256} from '../src/identity/nativeSupport.mjs';
import {CHARACTER_METADATA_SHA256} from '../src/characters/nativeSupport.mjs';
import {TestOwnerEvidence,worldProfileId} from './identity-fixtures.mjs';
import {profile} from './p2-fixtures.mjs';
import {createConversationJournalRecorder} from '../../lsa-shared-brain/src/memory/conversationRecorder.mjs';
import {createM5SqliteServices} from '../../lsa-shared-brain/src/memory/m5SqlitePrivacy.mjs';

test('E2 storage-only bootstrap keeps mandatory privacy across all M2–M9 off, restart and source retirement',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'e2-independent-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const configPath=path.join(root,'config.json');
 await writeFile(configPath,JSON.stringify({provider:'openai',
  persistentIdentity:{enabled:true,worldProfileId,storePath:path.join(root,'identity.json')},
  promotedCharacters:{enabled:true,storageMode:'sqlite',sqliteStorePath:path.join(root,'p2.sqlite'),storePath:path.join(root,'profiles.json')},
  memoryK:{profile:'storage-only'},intelligence:{mode:'off'}}));
 let runtime=await createRuntimeForBundle({configPath,env:{},enableTelemetry:false,startCharacterEditor:false,
  identityEvidence:new TestOwnerEvidence(),
  identityContract:{available:true,requiredGameTarget:'net481',dllSha256:IDENTITY_DLL_SHA256,metadataSha256:IDENTITY_METADATA_SHA256,nativeProtocolChanged:false},
  characterContract:{available:true,requiredGameTarget:'net481',dllSha256:IDENTITY_DLL_SHA256,metadataSha256:CHARACTER_METADATA_SHA256,nativeProtocolChanged:false},
  fetchImpl:()=>{throw Error('unexpected_provider_call');}});
 t.after(()=>runtime.dispose());
 let store=runtime.characterService.store;
 const npc=await store.create(profile()),timelineId=await store.createTimeline({label:'E2 independent'});
 const host={hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1};
 store.setVerifiedHostContext(host);await store.confirmTimeline(timelineId,{confirmation:timelineId});
 const scope={worldProfileId,characterId:npc.characterId,timelineId,protagonistKey:'franklin'};
 const recorder=createConversationJournalRecorder(store);
 const line=await recorder.recordPlayerAccepted({characterId:npc.characterId,
  identity:{pedId:101,turnId:'e2-runtime',generationId:'g1',sessionNonce:'e2'},
  text:'independent private secret',source:'typed',attribution:{protagonist:'franklin'}});
 const p=createM5SqliteServices({store,filePath:store.filePath,authorize:()=>true});
 await p.trash({scope,targetId:line.recordId,operationId:randomUUID()});
 const assertOff=()=>{
  const rows=runtime.services.memoryKRuntimeDiagnostics().capabilities;
  for(const {id} of MEMORY_K_CAPABILITIES.filter(d=>d.id.startsWith('memory.')||d.id.startsWith('events.')))
   assert.equal(rows[id].effectiveMode,'off',id);
  assert.equal(rows['privacy.core'].state,'guarded');
  assert.equal(rows['privacy.core'].effectiveMode,'on');
  assert.equal(rows['privacy.core'].operationalState,'scope_verification_required');
  assert.equal(runtime.memoryM3,undefined);
 };
 assertOff();
 assert.ok((await store.listSuppressedMemoryIds({...scope,protagonistKey:'trevor'})).includes(line.recordId));
 runtime=await runtime.restart();store=runtime.characterService.store;
 assertOff();assert.equal(store.timelineWritable,false,'restart cannot inherit source authorization');
 store.setVerifiedHostContext({...host,hostRunId:randomUUID()});await store.confirmTimeline(timelineId,{confirmation:timelineId});
 assert.ok((await store.listSuppressedMemoryIds({...scope,protagonistKey:'michael'})).includes(line.recordId));
 assert.deepEqual((await store.readCommittedEvidencePage({scope})).items,[]);
 store.setVerifiedHostContext(null);
 await assert.rejects(store.readCommittedEvidencePage({scope}),/timeline_write_suspended/);
 await assert.rejects(createM5SqliteServices({store,filePath:store.filePath,authorize:()=>true})
  .trashScope({scope,operationId:randomUUID()}),/timeline_write_suspended/);
 await runtime.dispose();
 assert.equal(runtime.services.memoryKRuntimeDiagnostics().capabilities['privacy.core'].effectiveMode,'off');
});
