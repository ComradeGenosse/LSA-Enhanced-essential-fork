// Bounded, offline PCM fallback selection. Never asks Luna, TTS or a network provider.
// Only verified persistent characters may use their own recorded voices.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\.wav$/;
const CATEGORIES = new Set(['misheard','lost_thought','speech_lost','action_unconfirmed','action_succeeded','action_failed']);
const MAX_PCM_BYTES = 336000; // 7 seconds at 24kHz, mono, PCM16
const previous = new Map();

export function fallbackCategory({terminalReason,actionState}={}) {
  if(actionState==='succeeded')return 'action_succeeded';
  if(actionState==='failed')return 'action_failed';
  if(actionState==='unverified')return 'action_unconfirmed';
  if(terminalReason==='stt_error')return 'misheard';
  if(terminalReason==='model_error'||terminalReason==='invalid_decision'||
     terminalReason==='model_refusal')return 'lost_thought';
  return 'speech_lost';
}

export function decodeFallbackWav(buffer) {
  if(!Buffer.isBuffer(buffer)||buffer.length<=44||buffer.length>MAX_PCM_BYTES+44)
    throw new Error('fallback_invalid_wav');
  if(buffer.toString('ascii',0,4)!=='RIFF'||buffer.readUInt32LE(4)!==buffer.length-8||
     buffer.toString('ascii',8,12)!=='WAVE'||buffer.toString('ascii',12,16)!=='fmt '||
     buffer.readUInt32LE(16)!==16||buffer.readUInt16LE(20)!==1||
     buffer.readUInt16LE(22)!==1||buffer.readUInt32LE(24)!==24000||
     buffer.readUInt32LE(28)!==48000||buffer.readUInt16LE(32)!==2||
     buffer.readUInt16LE(34)!==16||buffer.toString('ascii',36,40)!=='data'||
     buffer.readUInt32LE(40)!==buffer.length-44||
     (buffer.length-44)%2!==0)throw new Error('fallback_invalid_wav');
  return buffer.subarray(44);
}
function verifiedCharacter(turn) {
  const id=turn?.characterSnapshot?.resolution?.characterId;
  if(turn?.characterSnapshot?.resolution?.kind!=='persistent'||!UUID.test(String(id||''))||
     turn?.characterInputs?.profile?.characterId!==id)return null;
  return id;
}
function manifestEntries(data,characterId,voice) {
  if(!data||data.version!==1||!Array.isArray(data.characters)||data.characters.length>128)
    throw new Error('fallback_invalid_manifest');
  const pack=data.characters.find(p=>p?.characterId===characterId);
  if(!pack||pack.voice!==voice||!Array.isArray(pack.clips)||pack.clips.length>64)return [];
  const ids=new Set();
  const clips=[];
  for(const c of pack.clips){
    if(!c||!ID.test(String(c.id||''))||ids.has(c.id)||!FILE.test(String(c.asset||''))||
      !CATEGORIES.has(c.category)||typeof c.text!=='string'||
      !c.text.trim()||c.text.length>240)throw new Error('fallback_invalid_manifest');
    ids.add(c.id);
    clips.push(c);
  }
  return clips;
}
export async function selectLocalFallback({config,turn,category,signal,read=readFile}={}) {
  const setting=config?.localVoiceFallback;
  if(setting?.enabled!==true||signal?.aborted||!CATEGORIES.has(category))
    return {status:'disabled'};
  const characterId=verifiedCharacter(turn);
  const voice=turn?.speechProfile?.voice;
  if(!characterId||typeof voice!=='string'||!ID.test(voice))
    return {status:'identity_unverified'};
  const dirname=setting.assetDirectory;
  if(typeof dirname!=='string'||!ID.test(dirname))return {status:'invalid_config'};
  const folder=path.join(ROOT,dirname);
  const timeoutMs=setting.maxRecoveryDelayMs??1500;
  const reader=async()=>{
    const raw=await read(path.join(folder,'manifest.json'));
    if(signal?.aborted)return {status:'cancelled'};
    const data=JSON.parse(String(raw));
    const clips=manifestEntries(data,characterId,voice).filter(c=>c.category===category);
    if(!clips.length)return {status:'asset_missing'};
    const rotationKey=characterId+':'+category;
    const last=previous.get(rotationKey);
    const selected=clips.find(c=>c.id!==last)||clips[0];
    const wav=await read(path.join(folder,characterId,selected.asset));
    if(signal?.aborted)return {status:'cancelled'};
    const pcm=decodeFallbackWav(wav);
    if(previous.size>=256)previous.delete(previous.keys().next().value);
    previous.set(rotationKey,selected.id);
    return {status:'selected',characterId,assetId:selected.id,category,text:selected.text,pcm};
  };
  let timer;
  try{
    return await Promise.race([reader(),new Promise(resolve=>{
      timer=setTimeout(()=>resolve({status:'read_timeout'}),timeoutMs);
    })]);
  }catch(error){
    const code=error?.code==='ENOENT'?'asset_missing':
      error?.message==='fallback_invalid_wav'?'invalid_wav':'asset_invalid';
    return {status:code};
  }finally{clearTimeout(timer);}
}
