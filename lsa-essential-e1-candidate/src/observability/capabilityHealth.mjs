import {open} from 'node:fs/promises';
import {isUuid} from '../identity/identityContract.mjs';
import {perceptionContractSupported} from '../perception/nativeSupport.mjs';
import {dialogueKnowledgeContractSupported} from '../config/dialogueKnowledge.mjs';
import {readHostContext,sameHostContext} from '../context/hostContext.mjs';

const ACT2=Object.freeze(['hold_position','follow_person','resume_ambient','sit_on_ground']);
export const HEALTH_CAPABILITIES=Object.freeze(['ps.perception','ps.dialogue_knowledge','ps.speech_heard',...ACT2.map(key=>`act.${key}`),'cge.gaze','radio.facts']);
const hash=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
const closed=(value,keys)=>value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));
// Acceptance records are evidence references, never config.passedProbes.
// Only externally recorded complete capability acceptance may set result=passed.
export function readCapabilityValidation(value){
 if(!closed(value,['version','receipts']) || value.version!==1 || !Array.isArray(value.receipts) || value.receipts.length>64)return Object.freeze([]);
 const rows=[];
 for(const row of value.receipts){
  if(!closed(row,['capability','payloadHash','sourceCommit','sessionId','result','evidenceSha256']) || !HEALTH_CAPABILITIES.includes(row.capability) || !hash(row.payloadHash) || !/^[a-f0-9]{40}$/.test(row.sourceCommit) || !isUuid(row.sessionId) || !['passed','failed','not_run'].includes(row.result) || !hash(row.evidenceSha256))return Object.freeze([]);
  rows.push(Object.freeze({...row}));
 }
 return Object.freeze(rows);
}
export async function loadCapabilityValidation(file){
 let handle;
 try{
  handle=await open(file,'r');
  if((await handle.stat()).size>64*1024)return Object.freeze([]);
  const bytes=Buffer.alloc(64*1024+1);let length=0;
  while(length<bytes.length){const result=await handle.read(bytes,length,bytes.length-length,length);if(!result.bytesRead)break;length+=result.bytesRead;}
  if(length>64*1024)return Object.freeze([]);
  return readCapabilityValidation(JSON.parse(bytes.subarray(0,length).toString('utf8')));
 }catch{return Object.freeze([]);}finally{await handle?.close().catch(()=>{});}
}
const host=value=>readHostContext(value)!==null;
export function projectCapabilityHealth({config={},manifest=null,payloadHash=null,validation=[],perception=null,activities=null}={}){
 const result={},psHost=host(perception?.hostContext)?perception.hostContext:null;
 const act=activities?.client?.runtime??activities?.runtime,actHost=host(act?.hostContext)?act.hostContext:null;
 const matched=dialogueKnowledgeContractSupported(manifest?.dialogueKnowledgeContract,manifest?.perceptionContract) && hash(manifest?.dialogueKnowledgeNativePayload?.manifestSha256);
 const rows=readCapabilityValidation({version:1,receipts:validation});
 const row=(key,compiled,configured,runtimeSupported,hostContext,suspended=false)=>{
  const last=new Map();for(const receipt of rows)if(receipt.capability===key)last.set(receipt.payloadHash,receipt.result);
  const validated=Object.freeze([...last].filter(([,value])=>value==='passed').map(([key])=>key).sort());
  result[key]=Object.freeze({compiled:compiled===true,configured,runtimeSupported:runtimeSupported===true,hostRunId:hostContext?.hostRunId??null,validated,suspended:suspended===true,active:compiled===true && configured==='active' && runtimeSupported===true && hash(payloadHash) && validated.includes(payloadHash) && suspended!==true});
 };
 const psReady=!!psHost && !!perception?.epoch;
 row('ps.perception',perceptionContractSupported(manifest?.perceptionContract),config.intelligence?.mode==='shadow'?'shadow':'off',psReady && perception.capabilities?.snapshot===true,psHost);
 row('ps.dialogue_knowledge',matched,['off','shadow','active'].includes(config.dialogueKnowledge?.mode)?config.dialogueKnowledge.mode:'off',psReady && config.provider==='openai' && perception.observerIndexVersion===1 && perception.observerSituationVersion===1,psHost);
 // Source-time utterance receipts and the two optional contributors are not compiled yet.
 row('ps.speech_heard',false,config.intelligence?.mode==='shadow'?'shadow':'off',false,psHost);
 for(const key of ACT2){
  const mixed=!!psHost && !!actHost && !sameHostContext(psHost,actHost);
  const supported=!!actHost && act?.ready===true && act.capabilities?.[key]===true && !mixed;
  const configured=config.activities?.mode==='on'?'active':config.activities?.mode==='shadow'?'shadow':'off';
  const localGate=configured==='active' && activities?.engine?.registry?.enabled(key,{mode:config.activities.mode,hello:act?.capabilities,requested:[key],passedProbes:config.activities.passedProbes,source:'player_ux',priority:'player_direct'})===true;
  row(`act.${key}`,matched,configured,supported,actHost,mixed || configured==='active' && !localGate);
 }
 row('cge.gaze',false,'off',false,null);row('radio.facts',false,'off',false,null);
 return Object.freeze(result);
}
