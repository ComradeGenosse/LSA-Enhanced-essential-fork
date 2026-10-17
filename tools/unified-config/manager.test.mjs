import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {run} from './manager.mjs';
import {TARGETS} from './schema.mjs';

const hash=s=>createHash('sha256').update(s).digest('hex');
const serialize=x=>JSON.stringify(x,null,2)+'\n';
const fixtures={
  e1:new URL('../../lsa-essential-e1-candidate/e1.config.example.json',import.meta.url),
  promoted:new URL('../../native/promoted-characters/LSA.PromotedCharacters.example.json',import.meta.url),
  enhanced:new URL('../../native/enhanced/LSA.Enhanced.example.json',import.meta.url)
};
async function setup(t,{secret=false}={}) {
  const game=await fs.mkdtemp(path.join(os.tmpdir(),'lsa-settings-test-'));
  t.after(()=>fs.rm(game,{recursive:true,force:true}));
  const files=Object.fromEntries(Object.entries(TARGETS).map(([key,value])=>[key,path.join(game,value)]));
  files.master=path.join(game,'LSA.settings.json');
  for(const [key,source] of Object.entries(fixtures)) {
    await fs.mkdir(path.dirname(files[key]),{recursive:true});
    const original=JSON.parse(await fs.readFile(source,'utf8'));
    if(key==='e1') {
      original.persistentIdentity.worldProfileId='d5555555-5555-4555-8555-555555555555';
      original.promotedCharacters.sqliteStorePath='characters/test.v2.sqlite';
      original.elevenLabs.voices={nathan:'A'.repeat(20)};
      if(secret) original.privateApiKey='not-for-master';
    }
    if(key==='promoted') original.worldProfileId='d5555555-5555-4555-8555-555555555555';
    await fs.writeFile(files[key],serialize(original));
  }
  await fs.mkdir(path.join(game,'plugins','LosSantosAlive'),{recursive:true});
  await fs.writeFile(path.join(game,'plugins','LosSantosAlive','LosSantosAlive.config'),'TalkKey=Mouse4\nTextKey=F9\nMarkPedKey=F5\nMarkedPedTalkKey=Mouse5\nApiKey=dont-touch\n');
  return {game,files};
}
async function read(f){return JSON.parse(await fs.readFile(f,'utf8'));}
async function editMaster(files,fn){const m=await read(files.master);fn(m);await fs.writeFile(files.master,serialize(m));}
async function importAndApply(game){const i=await run('import',{game});assert.equal(i.ok,true);const a=await run('apply',{game,activate:true});assert.equal(a.ok,true,JSON.stringify(a));return a;}

test('import retains exact values, world, SQLite path, voices and strips credentials',async t=>{
  const {game,files}=await setup(t,{secret:true});
  const original=await Promise.all(['e1','promoted','enhanced'].map(k=>fs.readFile(files[k],'utf8')));
  const imported=await run('import',{game});assert.equal(imported.ok,true);
  const m=await read(files.master);
  assert.equal(m.metadata.active,false);
  assert.equal(m.sections.memory.persistentIdentity.worldProfileId,'d5555555-5555-4555-8555-555555555555');
  assert.equal(m.sections.memory.promotedCharacters.sqliteStorePath,'characters/test.v2.sqlite');
  assert.equal(m.sections.voice.elevenLabs.voices.nathan,'A'.repeat(20));
  assert.doesNotMatch(JSON.stringify(m),/not-for-master|privateApiKey/);
  for(const [i,k] of ['e1','promoted','enhanced'].entries()) assert.equal(await fs.readFile(files[k],'utf8'),original[i]);
  const missingActivation=await run('apply',{game});assert.equal(missingActivation.ok,false);
  assert.match(missingActivation.error,/--activate/);
  const applied=await run('apply',{game,activate:true});assert.equal(applied.ok,true,JSON.stringify(applied));
  const values=await Promise.all(['e1','promoted','enhanced'].map(k=>read(files[k])));
  assert.equal(values[0].privateApiKey,'not-for-master');
  assert.equal(values[1].worldProfileId,m.sections.memory.native.worldProfileId);
  assert.equal(values[2].input.keys.L4,'F6');
});

test('one master edit updates supported E1/voice/UX values and retains unrelated fields',async t=>{
  const {game,files}=await setup(t,{secret:true});
  await run('import',{game});
  await editMaster(files,m=>{
    m.sections.ai.maxOutputTokens=500;
    m.sections.voice.ttsVolume=1.25;
    m.sections.ux.talkTargeting={...m.sections.ux.talkTargeting,enabled:true,key:'Mouse4'};
  });
  const diff=await run('diff',{game});
  assert.equal(diff.ok,true,JSON.stringify(diff));
  assert.ok(diff.changes.e1.includes('maxOutputTokens'));
  assert.ok(diff.changes.e1.includes('ttsVolume'));
  assert.ok(diff.changes.enhanced.includes('talkTargeting.enabled'));
  const result=await run('apply',{game,activate:true});
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal((await read(files.e1)).maxOutputTokens,500);
  assert.equal((await read(files.e1)).privateApiKey,'not-for-master');
  assert.equal((await read(files.enhanced)).talkTargeting.key,'Mouse4');
  assert.equal((await read(files.enhanced)).talkTargeting.enabled,true);
});

test('round trip import, apply, import preserves all semantically valid fields',async t=>{
  const {game,files}=await setup(t);
  await importAndApply(game);
  const before=await Promise.all(['e1','promoted','enhanced'].map(k=>read(files[k])));
  await run('import',{game,replace:true});
  const second=await read(files.master);
  assert.equal(second.metadata.active,false);
  const after=await Promise.all(['e1','promoted','enhanced'].map(k=>read(files[k])));
  assert.deepEqual(after,before);
  assert.deepEqual(second.sections.voice.elevenLabs.voices,before[0].elevenLabs.voices);
});

test('UX4 F10 vs Essential Mouse4 requires explicit verified neutral mapping',async t=>{
  const {game,files}=await setup(t);
  await run('import',{game});
  await editMaster(files,m=>{m.sections.ux.talkTargeting={enabled:true,key:'F10'};});
  const bad=await run('validate',{game});
  assert.equal(bad.ok,false);
  assert.ok(bad.problems.some(x=>x.code==='UX4_NEUTRAL_BINDING_UNCONFIRMED'));
  assert.equal((await run('apply',{game,activate:true})).ok,false);
  await editMaster(files,m=>{m.approvals.neutralTalkKey='F10';});
  const good=await run('validate',{game});
  assert.equal(good.ok,true,JSON.stringify(good));
});

test('UX4 collisions with Essential Text, Marked Talk, and Enhanced router are blocked',async t=>{
  const {game,files}=await setup(t);
  await fs.writeFile(path.join(game,'plugins/LosSantosAlive/LosSantosAlive.config'),'TalkKey=Mouse4\nTextKey=F10\nMarkPedKey=F5\nMarkedPedTalkKey=Mouse5\n');
  await run('import',{game});
  await editMaster(files,m=>{m.sections.ux.talkTargeting={enabled:true,key:'F10'};m.approvals.neutralTalkKey='F10';});
  const essential=await run('validate',{game});
  assert.equal(essential.ok,false);
  assert.ok(essential.problems.some(x=>x.code==='UX4_ESSENTIAL_COLLISION'));
  await fs.writeFile(path.join(game,'plugins/LosSantosAlive/LosSantosAlive.config'),'TalkKey=F10\nTextKey=F9\nMarkPedKey=F5\nMarkedPedTalkKey=Mouse5\n');
  await editMaster(files,m=>{m.sections.controls.input.keys.L4='F10';m.sections.controls.input.enabled=true;});
  const router=await run('validate',{game});
  assert.ok(router.problems.some(x=>x.code==='UX4_ROUTER_COLLISION'));
  assert.ok(router.problems.some(x=>x.code==='ROUTER_ESSENTIAL_COLLISION'));
});

test('pipe, world, feature, activity and reaction mismatches are rejected',async t=>{
  const {game,files}=await setup(t);
  await run('import',{game});
  await editMaster(files,m=>{
    m.sections.perception.native.intelligence.pipeName='Different.Pipe';
    m.sections.npcBehavior.native.reactions.mode='on';
    m.sections.memory.native.worldProfileId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  });
  const p=await run('validate',{game});
  assert.equal(p.ok,false);
  assert.ok(p.problems.some(x=>x.code==='PIPE_MISMATCH'));
  assert.ok(p.problems.some(x=>x.code==='WORLD_MISMATCH'));
  assert.ok(p.problems.some(x=>x.code==='FEATURE_MISMATCH'));
  assert.ok(p.problems.some(x=>x.code==='FEATURE_DEPENDENCY'));
});

test('unimplemented capability cannot be enabled',async t=>{
  const {game,files}=await setup(t);
  await run('import',{game});
  await editMaster(files,m=>{m.sections.memory.memoryK.capabilities['ps7.social']='on';});
  const output=await run('validate',{game});
  assert.equal(output.ok,false);
  assert.ok(output.problems.some(x=>x.code==='UNIMPLEMENTED_FEATURE'));
});

test('unknown-but-valid legacy E1 option survives while strict native schema rejects drift',async t=>{
  const {game,files}=await setup(t);
  const input=await read(files.e1);input.futureEnabledSetting={unexpected:'preserve'};
  await fs.writeFile(files.e1,serialize(input));
  await importAndApply(game);
  assert.deepEqual((await read(files.e1)).futureEnabledSetting,{unexpected:'preserve'});
  await editMaster(files,m=>{m.sections.extensions.enhanced.unrecognizedField=true;});
  const v=await run('validate',{game});
  assert.equal(v.ok,false);
  assert.ok(v.problems.some(x=>x.code==='ENHANCED_SCHEMA'));
});

test('invalid JSON, absent files, and unexpected master edits fail closed',async t=>{
  const {game,files}=await setup(t);
  await fs.writeFile(files.promoted,'{ broken');
  await assert.rejects(run('import',{game}),/invalid JSON/);
  await fs.rm(files.promoted);
  await assert.rejects(run('import',{game}),/Unable to read/);
  await fs.writeFile(files.promoted,await fs.readFile(fixtures.promoted,'utf8'));
  await run('import',{game});
  await editMaster(files,m=>{m.sections.voice.apiKey='secret';});
  await assert.rejects(run('validate',{game}),/Secret field prohibited/);
});

test('concurrent lock and external file edits block apply without overwriting',async t=>{
  const {game,files}=await setup(t);
  await run('import',{game});
  await fs.writeFile(files.master+'.lock','owned');
  await assert.rejects(run('apply',{game,activate:true}),/Another config operation/);
  await fs.rm(files.master+'.lock');
  const native=await read(files.promoted);native.editorPort=37001;
  await fs.writeFile(files.promoted,serialize(native));
  const p=await run('apply',{game,activate:true});
  assert.equal(p.ok,false);assert.ok(p.conflicts.some(x=>x.code==='EXTERNAL_EDIT'));
  assert.equal((await read(files.promoted)).editorPort,37001);
});

test('rollback restores previous valid target set and master while preserving backups',async t=>{
  const {game,files}=await setup(t);
  await run('import',{game});
  await editMaster(files,m=>{m.sections.ai.maxOutputTokens=700;});
  const a=await run('apply',{game,activate:true});
  assert.equal(a.ok,true,JSON.stringify(a));
  assert.equal((await read(files.e1)).maxOutputTokens,700);
  const result=await run('rollback',{game});
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal((await read(files.e1)).maxOutputTokens,300);
  assert.equal((await read(files.master)).sections.ai.maxOutputTokens,300);
  assert.equal(await fs.stat(a.backupDir).then(x=>x.isDirectory()),true);
  await assert.rejects(run('rollback',{game}),/No previous applied/);
});

test('prepared journal restores interrupted writes before a new apply',async t=>{
  const {game,files}=await setup(t);
  await run('import',{game});
  const backupDir=path.join(files.master+'.backups','injected-test');
  await fs.mkdir(backupDir,{recursive:true});
  const items={};
  for(const k of ['e1','promoted','enhanced','master']) {
    const before=await fs.readFile(files[k],'utf8');
    let after=before;
    if(k==='e1') {const object=JSON.parse(before);object.maxOutputTokens=777;after=serialize(object);}
    await fs.writeFile(path.join(backupDir,k+'.json'),before);
    items[k]={path:files[k],before:hash(before),after:hash(after)};
    if(k==='e1') await fs.writeFile(files.e1,after);
  }
  await fs.writeFile(files.master+'.txn.json',serialize({id:'injected-test',kind:'apply',phase:'prepared',backupDir,items,post:{}}));
  const p=await run('apply',{game,activate:true});
  assert.equal(p.ok,true,JSON.stringify(p));
  assert.equal((await read(files.e1)).maxOutputTokens,300);
  await assert.rejects(fs.stat(files.master+'.txn.json'),{code:'ENOENT'});
});

test('recovery refuses to overwrite a third-party edit after partial update',async t=>{
  const {game,files}=await setup(t);
  await run('import',{game});
  const backupDir=path.join(files.master+'.backups','interfered-test');
  await fs.mkdir(backupDir,{recursive:true});
  const items={};
  for(const k of ['e1','promoted','enhanced','master']) {
    const before=await fs.readFile(files[k],'utf8');
    await fs.writeFile(path.join(backupDir,k+'.json'),before);
    items[k]={path:files[k],before:hash(before),after:hash(before)};
  }
  await fs.writeFile(files.master+'.txn.json',serialize({id:'interfered-test',kind:'apply',phase:'prepared',backupDir,items,post:{}}));
  await fs.writeFile(files.e1,serialize({...await read(files.e1),maxOutputTokens:900}));
  await assert.rejects(run('apply',{game,activate:true}),/external modification/);
  assert.equal((await read(files.e1)).maxOutputTokens,900);
  assert.equal(await fs.stat(files.master+'.txn.json').then(()=>true),true);
});

test('permission error never reports successful apply',async t=>{
  const {game,files}=await setup(t);
  await run('import',{game});
  await editMaster(files,m=>{m.sections.ai.maxOutputTokens=333;});
  const dir=path.dirname(files.e1),stat=await fs.stat(dir);
  await fs.chmod(dir,0o500);
  try {
    if(process.getuid?.()===0) return t.skip('root bypasses Unix write permissions');
    await assert.rejects(run('apply',{game,activate:true}),/EACCES|EPERM/);
  } finally {await fs.chmod(dir,stat.mode);}
});