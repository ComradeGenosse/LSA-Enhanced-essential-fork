import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {verifyDialogueKnowledgePayload,intelligenceNativeSourceHash,KNOWLEDGE_NATIVE_FILES} from '../tools/verifyDialogueKnowledgePayload.mjs';
import {verifyPerceptionContract} from '../tools/verifyPerceptionContract.mjs';

async function fixture(t){
 const directory=await mkdtemp(path.join(tmpdir(),'lsa-knowledge-payload-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const perceptionContract=await verifyPerceptionContract();
 const manifest={intelligenceSourceSha256:await intelligenceNativeSourceHash(),sharedIntelligenceContract:{hostContextVersion:1,actorCaptureVersion:1,observerIndexVersion:1,observerSituationVersion:1,physicalAcceptance:false},perceptionContract,files:[]};
 for(const name of KNOWLEDGE_NATIVE_FILES){const bytes=Buffer.from(`offline verifier fixture ${name}`);await writeFile(path.join(directory,name),bytes);manifest.files.push({name,relativePath:name==='LSA.PromotedCharacters.dll'?`plugins/${name}`:`plugins/LSA.PromotedCharacters/${name}`,sha256:createHash('sha256').update(bytes).digest('hex')});}
 const save=()=>writeFile(path.join(directory,'build-manifest.json'),JSON.stringify(manifest));await save();return {directory,perceptionContract,manifest,save};
}
test('PS4 build support is explicit and bound to current native source and all package hashes',async t=>{
 const f=await fixture(t),missing=await verifyDialogueKnowledgePayload(undefined,f.perceptionContract);assert.equal(missing.contract.available,false);assert.equal(missing.nativePayload,null);
 const result=await verifyDialogueKnowledgePayload(f.directory,f.perceptionContract);assert.equal(result.contract.available,true);assert.equal(result.nativePayload.gtaRuntimeTest,false);assert.equal(result.nativePayload.files.length,4);assert.equal(result.nativePayload.sourceSha256,f.manifest.intelligenceSourceSha256);assert.equal(result.nativePayload.manifestSha256,createHash('sha256').update(await readFile(path.join(f.directory,'build-manifest.json'))).digest('hex'));
 for(const name of KNOWLEDGE_NATIVE_FILES){const file=path.join(f.directory,name),bytes=await readFile(file);await writeFile(file,'modified');await assert.rejects(verifyDialogueKnowledgePayload(f.directory,f.perceptionContract),/knowledge_native_payload_hash/);await writeFile(file,bytes);}
});
test('PS4 build rejects stale source, versions, pins and incomplete or redirected native packaging',async t=>{
 const f=await fixture(t),baseline=structuredClone(f.manifest);
 for(const patch of [{intelligenceSourceSha256:'0'.repeat(64)},{sharedIntelligenceContract:{...baseline.sharedIntelligenceContract,actorCaptureVersion:2}},{perceptionContract:{...f.perceptionContract,available:false}},{files:baseline.files.slice(1)},{files:baseline.files.map((entry,index)=>index?entry:{...entry,relativePath:'../other.dll'})}]){
  Object.assign(f.manifest,baseline,patch);await f.save();await assert.rejects(verifyDialogueKnowledgePayload(f.directory,f.perceptionContract),/knowledge_native_payload_/);
 }
 Object.assign(f.manifest,baseline);await f.save();await assert.rejects(verifyDialogueKnowledgePayload(f.directory,{...f.perceptionContract,available:false}),/knowledge_native_payload_contract/);
});

test('native source receipt excludes test projects and generated output but detects production edits',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'lsa-native-source-hash-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(path.join(root,'Runtime.cs'),'production source');const before=await intelligenceNativeSourceHash(root);
 for(const name of ['tests','lifecycle-tests','bridge-tests','bin','obj']){await mkdir(path.join(root,name));await writeFile(path.join(root,name,'Substitute.cs'),'test or generated source');}
 assert.equal(await intelligenceNativeSourceHash(root),before);
 await writeFile(path.join(root,'Runtime.cs'),'changed production source');assert.notEqual(await intelligenceNativeSourceHash(root),before);
});
