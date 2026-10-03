import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { IDENTITY_DLL_SHA256 } from '../src/identity/nativeSupport.mjs';
import { DAMAGE_DLL_SHA256, PERCEPTION_METADATA_SHA256, DAMAGE_METADATA_SHA256 } from '../src/perception/nativeSupport.mjs';
export async function verifyPerceptionContract(dllHash=IDENTITY_DLL_SHA256, { essentialText,damageText }={}) {
  try {
    const essential=essentialText??await readFile(new URL('../docs/intelligence-essential-metadata.json',import.meta.url));
    const damage=damageText??await readFile(new URL('../docs/intelligence-damage-metadata.json',import.meta.url));
    const hash=b=>createHash('sha256').update(b).digest('hex');
    if(dllHash!==IDENTITY_DLL_SHA256 || hash(essential)!==PERCEPTION_METADATA_SHA256 || hash(damage)!==DAMAGE_METADATA_SHA256) throw new Error('pin');
    const e=JSON.parse(String(essential)),d=JSON.parse(String(damage));
    if(e.dllSha256!==dllHash || d.dllSha256!==DAMAGE_DLL_SHA256) throw new Error('dll');
    const method=(data,type,name,returns,parameters)=>{
      const matches=data.types.filter(t=>t.name===type);if(matches.length!==1 || matches[0].methods.filter(m=>m.name===name&&m.returns===returns&&JSON.stringify(m.parameters)===JSON.stringify(parameters)).length!==1) throw new Error('signature');
    };
    method(e,'LosSantosAlive.NPC.Perception.PerceptionSystem','TryGetSnapshot','Boolean',['LosSantosAlive.NPC.Perception.PerceptionSnapshot&']);
    method(e,'LosSantosAlive.NPC.NpcStateStore','TryGetState','LosSantosAlive.NPC.NpcState',['Rage.Ped']);
    for(const name of ['GetPlayerConversationPed','GetCurrentSpeakerPed']) method(e,'LosSantosAlive.NPC.NpcTargeting',name,'Rage.Ped',[]);
    method(e,'LosSantosAlive.NPC.Perception.PerceptionSnapshot','get_IsValid','Boolean',[]);
    for(const [name,event] of [['PlaybackStarted','NpcPlaybackStartedEvent'],['PlaybackEnded','NpcPlaybackEndedEvent']]) for(const prefix of ['add_','remove_']) method(e,'LosSantosAlive.Audio.NpcPlaybackCoordinator',prefix+name,'Void',[`System.Action\u00601<LosSantosAlive.Audio.${event}>`]);
    const type='DamageTrackerLib.DamageTrackerService';
    method(d,type,'get_IsRunning','Boolean',[]);
    for(const [name,delegate] of [['OnPedTookDamage','PedTookDamageDelegate'],['OnPlayerTookDamage','PedTookDamageDelegate'],['OnVehicleTookDamage','VehTookDamageDelegate']]) for(const prefix of ['add_','remove_']) method(d,type,prefix+name,'Void',[type+'+'+delegate]);
    return {available:true,version:1,dllSha256:dllHash,damageDllSha256:DAMAGE_DLL_SHA256,metadataSha256:PERCEPTION_METADATA_SHA256,damageMetadataSha256:DAMAGE_METADATA_SHA256,requiredGameTarget:'net481',shadowOnly:true,nativeProtocolChanged:false};
  }catch{return {available:false,reason:'optional_perception_contract_unavailable',nativeProtocolChanged:false};}
}
