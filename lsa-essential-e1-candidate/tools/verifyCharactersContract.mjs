import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { IDENTITY_DLL_SHA256 } from '../src/identity/nativeSupport.mjs';
import { CHARACTER_METADATA_SHA256 } from '../src/characters/nativeSupport.mjs';
export async function verifyCharactersContract(dllHash = IDENTITY_DLL_SHA256,metadataText) {
  try {
    const bytes = metadataText ?? await readFile(new URL('../docs/promoted-characters-native-metadata.json',import.meta.url));
    if (dllHash !== IDENTITY_DLL_SHA256 || createHash('sha256').update(bytes).digest('hex') !== CHARACTER_METADATA_SHA256) throw new Error('character_metadata_mismatch');
    const data = JSON.parse(String(bytes)); if (data.dllSha256 !== dllHash) throw new Error('character_dll_mismatch');
    const type = name => { const matches = data.types.filter(type => type.name === name); if (matches.length !== 1) throw new Error('character_type_mismatch'); return matches[0]; };
    const method = (name,methodName,returns,parameters) => {
      if (type(name).methods.filter(method => method.name === methodName && method.returns === returns && JSON.stringify(method.parameters) === JSON.stringify(parameters)).length !== 1) throw new Error('character_signature_mismatch');
    };
    for (const name of ['FollowTarget','WaitHere']) method('LosSantosAlive.NPC.NpcActions',name,'Void',['Rage.Ped']);
    method('LosSantosAlive.NPC.NpcActions','HasExclusiveControl','Boolean',['Rage.Ped']);
    method('LosSantosAlive.NPC.NpcActions','ReleaseExclusiveControlForExternalSystem','Void',['Rage.Ped','String','Boolean']);
    method('LosSantosAlive.NPC.NpcFocus','SetFocus','Void',['Rage.Ped','Rage.Ped','String']);
    for (const name of ['GetPlayerConversationPed','GetCurrentSpeakerPed']) method('LosSantosAlive.NPC.NpcTargeting',name,'Rage.Ped',[]);
    for (const name of ['GetStateForActiveBehavior','TryGetState']) method('LosSantosAlive.NPC.NpcStateStore',name,'LosSantosAlive.NPC.NpcState',['Rage.Ped']);
    method('LosSantosAlive.NPC.NpcState','DemoteToPassiveRuntime','Void',[]);
    method('LosSantosAlive.Context.Providers.ActorContextProvider','Populate','Void',['LosSantosAlive.Context.ActorContext','Rage.Ped']);
    for (const name of ['FollowPlayerOnFoot','FollowPaused','EnterPassengerSeatWhenPlayerEnters','ExitVehicleWhenPlayerExits','StayUnderLsaControl','InDirectedInteraction','AccompliceMode']) if (type('LosSantosAlive.NPC.NpcState').fields.filter(field => field.name === name && field.type === 'Boolean').length !== 1) throw new Error('character_field_mismatch');
    return {available:true,dllSha256:dllHash,metadataSha256:CHARACTER_METADATA_SHA256,requiredGameTarget:'net481',nativeProtocolChanged:false};
  } catch { return {available:false,reason:'optional_character_contract_unavailable',nativeProtocolChanged:false}; }
}
