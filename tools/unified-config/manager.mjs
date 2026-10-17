import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { TARGETS, importSections, generate, validateConfigs, findDisabledFeatures, assertNoSecrets } from './schema.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value,null,2)+'\n';
const jsonObject = (s,name) => {
  let v;
  try {v=JSON.parse(s);}catch(e){throw new Error(name+' is invalid JSON: '+e.message);}
  if(!v||typeof v!=='object'||Array.isArray(v)) throw new Error(name+' must be a JSON object');
  return v;
};
const code = e => e?.code||e?.message||String(e);
const exists = async f => fs.stat(f).then(()=>true,e=>e.code==='ENOENT'?false:Promise.reject(e));
const originalText = async f => fs.readFile(f,'utf8').catch(e=>{throw new Error('Unable to read '+f+': '+code(e));});
async function atomicWrite(file,data) {
  const dir=path.dirname(file),temp=path.join(dir,'.lsa-config-'+randomUUID()+'.tmp');
  const old=await fs.stat(file).catch(e=>e.code==='ENOENT'?null:Promise.reject(e));
  let handle;
  try {
    handle=await fs.open(temp,'wx',old?.mode&0o777||0o600);
    await handle.writeFile(data,'utf8');
    await handle.sync();
    await handle.close(); handle=null;
    await fs.rename(temp,file);
    try {const dirHandle=await fs.open(dir,'r');try{await dirHandle.sync();}finally{await dirHandle.close();}}catch(e){if(process.platform!=='win32') throw e;}
  } finally {
    if(handle) await handle.close().catch(()=>{});
    await fs.unlink(temp).catch(e=>{if(e.code!=='ENOENT') throw e;});
  }
}
function pathsFor(game,masterPath) {
  const root=path.resolve(game);
  return {e1:path.join(root,TARGETS.e1),promoted:path.join(root,TARGETS.promoted),enhanced:path.join(root,TARGETS.enhanced),master:path.resolve(masterPath||path.join(root,'LSA.settings.json'))};
}
async function lock(file,fn) {
  const lockFile=file+'.lock';
  let handle;
  try {handle=await fs.open(lockFile,'wx',0o600);}
  catch(e) {
    if(e.code==='EEXIST') throw new Error('Another config operation owns '+lockFile+'; inspect before deleting a stale lock');
    throw e;
  }
  try {
    await handle.writeFile(json({pid:process.pid,host:os.hostname(),createdAt:new Date().toISOString()}));
    await handle.sync();
    return await fn();
  } finally {
    await handle.close().catch(()=>{});
    await fs.unlink(lockFile).catch(()=>{});
  }
}
export async function readTargets(files) {
  const texts={},raw={};
  for(const name of ['e1','promoted','enhanced']) {
    texts[name]=await originalText(files[name]);
    raw[name]=jsonObject(texts[name],name);
  }
  return {texts,raw};
}
const baselines = texts => Object.fromEntries(Object.entries(texts).map(([k,v])=>[k,digest(v)]));
async function essentialFile(game) {
  const f=path.join(game,'plugins/LosSantosAlive/LosSantosAlive.config');
  try {return await fs.readFile(f,'utf8');}
  catch(e) {if(e.code==='ENOENT') return null;throw e;}
}
function metadata(master) {
  if(master.version!==1||!master.metadata||typeof master.metadata!=='object'||!master.metadata.baselines) throw new Error('Invalid/unimported master; use import first');
  for(const name of ['e1','promoted','enhanced']) if(!/^[0-9a-f]{64}$/.test(master.metadata.baselines[name]||'')) throw new Error('Invalid baseline for '+name);
  assertNoSecrets(master);
}
export async function readMaster(file) {
  const master=jsonObject(await originalText(file),'master');
  metadata(master);
  return master;
}
function relativeChanges(before,after,prefix='',out=[]) {
  if(JSON.stringify(before)===JSON.stringify(after)) return out;
  if(before&&after&&typeof before==='object'&&typeof after==='object'&&!Array.isArray(before)&&!Array.isArray(after)) {
    for(const key of new Set([...Object.keys(before),...Object.keys(after)])) relativeChanges(before[key],after[key],prefix?prefix+'.'+key:key,out);
  } else out.push(prefix||'$');
  return out;
}
async function plan(game,files) {
  const master=await readMaster(files.master);
  const {texts,raw}=await readTargets(files);
  const conflicts=[];
  for(const name of ['e1','promoted','enhanced']) if(digest(texts[name])!==master.metadata.baselines[name]) conflicts.push({code:'EXTERNAL_EDIT',detail:name+' changed since import/last apply. Re-import deliberately; no writes made.'});
  const generated=generate(master,raw);
  const check=validateConfigs(generated,master,await essentialFile(game));
  check.problems.push(...findDisabledFeatures(raw,generated,master.approvals||{}));
  check.ok=check.problems.length===0;
  const differences=Object.fromEntries(['e1','promoted','enhanced'].map(name=>[name,relativeChanges(raw[name],generated[name])]));
  const nextTexts=Object.fromEntries(['e1','promoted','enhanced'].map(name=>{
    if(JSON.stringify(raw[name])===JSON.stringify(generated[name])) return [name,texts[name]];
    let result=json(generated[name]);
    if(name==='enhanced'&&Buffer.byteLength(result)>16384) result=JSON.stringify(generated[name])+'\n';
    if(name==='promoted'&&result.length>4096) result=JSON.stringify(generated[name])+'\n';
    return [name,result];
  }));
  if(Buffer.byteLength(nextTexts.enhanced)>16384) check.problems.push({code:'NATIVE_FILE_SIZE',detail:'Enhanced runtime file exceeds 16384-byte parser limit'});
  if(nextTexts.promoted.length>4096) check.problems.push({code:'NATIVE_FILE_SIZE',detail:'Promoted native runtime file exceeds 4096-character parser limit'});
  check.ok=check.problems.length===0;
  return {master,raw,texts,generated,check,differences,nextTexts,conflicts,ok:!conflicts.length&&check.ok};
}
function statePaths(files) {
  return {journal:files.master+'.txn.json',last:files.master+'.last.json',backups:files.master+'.backups'};
}
async function journalRead(p) {
  if(!(await exists(p))) return null;
  return jsonObject(await originalText(p),'transaction journal');
}
async function safeRecover(files) {
  const state=statePaths(files),j=await journalRead(state.journal);
  if(!j) return {recovered:false};
  const names=['e1','promoted','enhanced','master'];
  if(!j.id||!['apply','rollback'].includes(j.kind)||!['prepared','committed'].includes(j.phase)) throw new Error('Unknown transaction journal; manual intervention required');
  const expectedDir=path.join(state.backups,j.id);
  if(path.resolve(j.backupDir)!==path.resolve(expectedDir)) throw new Error('Invalid journal backup location');
  for(const name of names) if(!j.items?.[name]||path.resolve(j.items[name].path)!==path.resolve(files[name])) throw new Error('Invalid transaction file target');
  if(j.phase==='committed') {
    for(const name of names) if(digest(await originalText(files[name]))!==j.post[name]) throw new Error('Completed transaction modified externally: '+name);
    if(j.kind==='apply') await atomicWrite(state.last,json({id:j.id,backupDir:j.backupDir,post: j.post,kind:'apply'}));
    else await fs.unlink(state.last).catch(e=>{if(e.code!=='ENOENT') throw e;});
    await fs.unlink(state.journal);
    return {recovered:true,action:'finalized'};
  }
  // No restoration if any file was changed by a different writer: fail closed.
  for(const name of names) {
    const row=j.items[name],actual=await originalText(files[name]);
    if(![row.before,row.after].includes(digest(actual))) throw new Error('Interrupted transaction has external modification in '+name+'; manual recovery required');
    const saved=await originalText(path.join(j.backupDir,name+'.json'));
    if(digest(saved)!==row.before) throw new Error('Backup integrity failure in '+name);
  }
  for(const name of names) {
    const row=j.items[name],actual=await originalText(files[name]);
    if(digest(actual)!==row.before) await atomicWrite(files[name],await originalText(path.join(j.backupDir,name+'.json')));
  }
  await fs.unlink(state.journal);
  return {recovered:true,action:'restored'};
}
async function transaction(files,kind,changes,expected=null) {
  const state=statePaths(files),id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID();
  const dir=path.join(state.backups,id);
  await fs.mkdir(dir,{recursive:true,mode:0o700});
  const items={},post={};
  for(const name of ['e1','promoted','enhanced','master']) {
    const before=await originalText(files[name]),after=changes[name];
    if(expected&&expected[name]&&digest(before)!==expected[name]) throw new Error('Concurrent modification detected during '+kind+': '+name);
    items[name]={path:files[name],before:digest(before),after:digest(after)};
    post[name]=digest(after);
    const backup=await fs.open(path.join(dir,name+'.json'),'wx',0o600);
    try {await backup.writeFile(before,'utf8');await backup.sync();}finally{await backup.close();}
  }
  const journal={version:1,id,kind,phase:'prepared',backupDir:dir,items,post};
  await atomicWrite(state.journal,json(journal));
  try {
    for(const name of ['e1','promoted','enhanced','master']) {
      if(items[name].before!==items[name].after) await atomicWrite(files[name],changes[name]);
    }
    await atomicWrite(state.journal,json({...journal,phase:'committed'}));
    if(kind==='apply') await atomicWrite(state.last,json({id,backupDir:dir,post,kind}));
    else await fs.unlink(state.last).catch(e=>{if(e.code!=='ENOENT') throw e;});
    await fs.unlink(state.journal);
    return {backupDir:dir};
  } catch(e) {
    try {await safeRecover(files);}catch(recoveryError) {throw new Error('Transaction failed: '+e.message+'; recovery blocked: '+recoveryError.message);}
    throw e;
  }
}
export async function run(command,{game,masterPath,activate=false,replace=false}={}) {
  if(!game) throw new Error('game location required');
  const files=pathsFor(game,masterPath),state=statePaths(files);
  const mutates=['import','apply','rollback'].includes(command);
  const action=async()=>{
    if(mutates) await safeRecover(files);
    else if(await exists(state.journal)) return {ok:false,error:'Interrupted transaction detected; run apply or rollback to recover under lock (read-only command did not change files)'};
    if(command==='import') {
      if(!replace&&await exists(files.master)) throw new Error('Master already exists; import --replace deliberately if needed');
      const {raw,texts}=await readTargets(files);
      const m={version:1,metadata:{active:false,importedAt:new Date().toISOString(),baselines:baselines(texts)},approvals:{},sections:importSections(raw)};
      assertNoSecrets(m);
      if(replace&&await exists(files.master)) {
        const importBackup=files.master+'.imports';
        await fs.mkdir(importBackup,{recursive:true,mode:0o700});
        await atomicWrite(path.join(importBackup,randomUUID()+'.json'),await originalText(files.master));
      }
      await atomicWrite(files.master,json(m));
      return {ok:true,master:files.master,active:false,imported:['e1','promoted','enhanced'],note:'Import does not modify runtime configuration; review and explicitly activate'};
    }
    if(command==='rollback') {
      const last=await journalRead(state.last);
      if(!last||last.kind!=='apply') throw new Error('No previous applied transaction to roll back');
      const expectedDir=path.join(state.backups,last.id);
      if(path.resolve(last.backupDir)!==path.resolve(expectedDir)) throw new Error('Invalid rollback location');
      const changes={},raw={};
      for(const name of ['e1','promoted','enhanced','master']) {
        const current=await originalText(files[name]);
        if(digest(current)!==last.post[name]) throw new Error('External modification since apply: '+name+'; refusing rollback');
        changes[name]=await originalText(path.join(last.backupDir,name+'.json'));
        if(name!=='master') raw[name]=jsonObject(changes[name],name);
      }
      const oldMaster=jsonObject(changes.master,'saved master');
      const restored={...oldMaster,metadata:{...oldMaster.metadata,active:true,baselines:baselines(changes),pendingRestart:['e1','promoted']},sections:importSections(raw)};
      changes.master=json(restored);
      const tx=await transaction(files,'rollback',changes,last.post);
      return {ok:true,rolledBack:true,backupDir:tx.backupDir};
    }
    if(!['status','validate','diff','apply'].includes(command)) throw new Error('Unknown command '+command);
    const p=await plan(game,files);
    const toRestart=Object.entries(p.differences).filter(([k,v])=>v.length&&k!=='enhanced').map(([k])=>k);
    const report={ok:p.ok,active:p.master.metadata.active===true,conflicts:p.conflicts,problems:p.check.problems,warnings:p.check.warnings,changes:p.differences,
      restartRequired:toRestart,pendingRestart:p.master.metadata.pendingRestart||[],
      operationalStatus:'unverified_without_running_GTA',
      configured:{aiProvider:p.generated.e1.provider,speechProvider:p.generated.e1.speechProvider,ux4Enabled:p.generated.enhanced.talkTargeting?.enabled===true,memoryCapabilities:p.generated.e1.memoryK?.capabilities||{}}
    };
    if(command==='status'||command==='validate'||command==='diff') return report;
    if(!p.ok) return {...report,error:'Validation/conflict failure: nothing changed'};
    if(!report.active&&!activate) return {...report,ok:false,error:'First apply requires explicit --activate; import is not activation'};
    // Even initial activation must be intentional. Import captured current installed values.
    const newMaster={...p.master,metadata:{...p.master.metadata,active:true,appliedAt:new Date().toISOString(),baselines:baselines(p.nextTexts),pendingRestart:[...new Set([...(p.master.metadata.pendingRestart||[]),...toRestart])]}};
    const changes={...p.nextTexts,master:json(newMaster)};
    const currentMaster=await originalText(files.master);
    if(JSON.stringify(jsonObject(currentMaster,'master'))!==JSON.stringify(p.master)) throw new Error('Master changed during apply; refusing write');
    const targetHashes=baselines(p.texts);
    const tx=await transaction(files,'apply',changes,{...targetHashes,master:digest(currentMaster)});
    return {...report,ok:true,active:true,applied:true,backupDir:tx.backupDir};
  };
  return mutates?lock(files.master,action):action();
}