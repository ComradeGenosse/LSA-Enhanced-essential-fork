// P2-owned SQLite durability helpers; no second writer.
import * as fs from 'node:fs/promises';
import {constants as fsConstants} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const fail = code => {throw new Error(code);};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const JOURNAL_CAPS=Object.freeze({events:25000,characterBytes:64*1024*1024,globalBytes:1024*1024*1024});
function parseOwner(raw){
  let o;try{o=JSON.parse(raw);}catch{return null;}
  if(!o||!Number.isSafeInteger(o.pid)||o.pid<=0||typeof o.hostname!=='string'||!o.hostname||
     !uuid.test(o.hostRunId)||typeof o.startedAt!=='string'||Number.isNaN(Date.parse(o.startedAt)))return null;
  return o;
}
function alive(pid){
  try{process.kill(pid,0);return true;}
  catch(e){return e.code!=='ESRCH';}
}
export async function inspectWriterLock(lockPath){
  let raw;try{raw=await fs.readFile(lockPath,'utf8');}
  catch(e){if(e.code==='ENOENT')return {status:'unlocked'};throw e;}
  const owner=parseOwner(raw);
  if(!owner)return {status:'unverifiable'};
  return {status:owner.hostname!==os.hostname()?'remote_owner':alive(owner.pid)?'live_owner':'stale_owner',owner};
}
export async function acquireWriterLock(lockPath){
  const owner={pid:process.pid,hostRunId:randomUUID(),startedAt:new Date().toISOString(),hostname:os.hostname()};
  const token=JSON.stringify(owner)+'\n';
  const open=async()=>{
    const handle=await fs.open(lockPath,'wx',0o600);
    try{await handle.writeFile(token);await handle.sync();}
    catch(e){await handle.close().catch(()=>{});await fs.rm(lockPath,{force:true}).catch(()=>{});throw e;}
    return {handle,owner,token,reclaimed:false};
  };
  try{return await open();}catch(e){if(e.code!=='EEXIST')throw e;}
  // Serialize recovery: concurrent contenders must not unlink the new owner.
  const gate=lockPath+'.recovery';
  try{await fs.mkdir(gate,{mode:0o700});}
  catch(e){if(e.code==='EEXIST')fail('sqlite_writer_recovery_busy');throw e;}
  try{
    const status=await inspectWriterLock(lockPath);
    if(status.status!=='stale_owner')
      fail('sqlite_writer_busy'); // legacy/unverifiable lock remains operator-only recovery
    const raw=await fs.readFile(lockPath,'utf8');
    if(JSON.stringify(parseOwner(raw))!==JSON.stringify(status.owner))fail('sqlite_writer_recovery_race');
    await fs.rm(lockPath);
    const lease=await open();
    return {...lease,reclaimed:true};
  }finally{await fs.rmdir(gate).catch(()=>{});}
}
export async function releaseWriterLock(lockPath,lease){
  if(!lease)return;
  try{
    await lease.handle.close();
    if(await fs.readFile(lockPath,'utf8')===lease.token)await fs.rm(lockPath);
  }catch(e){if(e.code!=='ENOENT')throw e;}
}
const sqlLiteral=s=>"'"+s.replaceAll("'","''")+"'";
function weekKey(date){
  const d=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));
  d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));
  const y=d.getUTCFullYear(),start=new Date(Date.UTC(y,0,1));
  return `${y}-W${String(Math.ceil((((d-start)/86400000)+1)/7)).padStart(2,'0')}`;
}
export async function snapshotSqlite(db,filePath,{reason='session_end',now=new Date()}={}){
  if(db.isTransaction)fail('sqlite_snapshot_inside_transaction');
  if(!(now instanceof Date)||Number.isNaN(now.getTime()))fail('sqlite_snapshot_invalid_time');
  const folder=filePath+'.snapshots';await fs.mkdir(folder,{recursive:true});
  const day=now.toISOString().slice(0,10),temp=path.join(folder,'.'+randomUUID()+'.sqlite');
  const dest=path.join(folder,`daily-${day}.sqlite`);
  let published=false;
  try{
    db.exec('VACUUM INTO '+sqlLiteral(temp));
    const fh=await fs.open(temp,'r+'); // Windows requires writable handle for FlushFileBufferstry{await fh.sync();}finally{await fh.close();}
    const {DatabaseSync}=await import('node:sqlite');
    const check=new DatabaseSync(temp,{readOnly:true});
    try{if(check.prepare('PRAGMA quick_check').get().quick_check!=='ok')fail('sqlite_snapshot_integrity_failed');}
    finally{check.close();}
    await fs.rename(temp,dest);published=true;
    const weekly=path.join(folder,`weekly-${weekKey(now)}.sqlite`);
    try{await fs.copyFile(dest,weekly,fsConstants.COPYFILE_EXCL);}
    catch(e){if(e.code!=='EEXIST')throw e;}
    const names=(await fs.readdir(folder)).sort().reverse();
    for(const prefix of ['daily-','weekly-']){
      const keep=prefix==='daily-'?7:4;
      for(const old of names.filter(n=>n.startsWith(prefix)&&n.endsWith('.sqlite')).slice(keep))
        await fs.rm(path.join(folder,old));
    }
    return Object.freeze({status:'created',reason,path:dest});
  }finally{if(!published)await fs.rm(temp,{force:true}).catch(()=>{});}
}
function cap(value,defaultValue){
  if(value===undefined)return defaultValue;
  if(!Number.isSafeInteger(value)||value<1||value>defaultValue)fail('sqlite_invalid_journal_cap');
  return value;
}
export function enforceJournalCaps(db,{characterId,bytes,event=false,limits={}}){
  if(!Number.isSafeInteger(bytes)||bytes<0)fail('sqlite_invalid_journal_bytes');
  const eventsCap=cap(limits.events,JOURNAL_CAPS.events);
  const bytesCap=cap(limits.characterBytes,JOURNAL_CAPS.characterBytes);
  const globalCap=cap(limits.globalBytes,JOURNAL_CAPS.globalBytes);
  const count=db.prepare('SELECT count(*) AS n FROM event_journal WHERE character_id=?').get(characterId).n;
  if(event&&count>=eventsCap)fail('sqlite_journal_character_event_cap');
  const dialogue=db.prepare('SELECT coalesce(sum(length(CAST(envelope_json AS BLOB))+length(CAST(content AS BLOB))),0) AS n FROM dialogue_journal WHERE character_id=?').get(characterId).n;
  const events=db.prepare('SELECT coalesce(sum(length(CAST(envelope_json AS BLOB))),0) AS n FROM event_journal WHERE character_id=?').get(characterId).n;
  const evidence=db.prepare('SELECT coalesce(sum(length(CAST(s.source_evidence_json AS BLOB))),0) AS n FROM event_source_evidence s JOIN event_journal e ON e.record_id=s.record_id WHERE e.character_id=?').get(characterId).n;
  if(dialogue+events+evidence+bytes>bytesCap)fail('sqlite_journal_character_byte_cap');
  const page=db.prepare('PRAGMA page_size').get().page_size,pages=db.prepare('PRAGMA page_count').get().page_count;
  if(pages*page+bytes>globalCap)fail('sqlite_journal_global_byte_cap');
}
