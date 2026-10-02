import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { directory,claim,worldProfileId,TestOwnerEvidence } from './identity-fixtures.mjs';
import { ProfileStore } from '../src/characters/profileStore.mjs';
import { CharacterService } from '../src/characters/characterService.mjs';
import { IdentityResolver } from '../src/identity/identityResolver.mjs';
import { VoiceResolver } from '../src/voice/voiceResolver.mjs';
import { normalizeConfig } from '../src/config/e1Config.mjs';

export const appearance = () => ({version:1,components:[{slot:0,drawable:0,texture:0,palette:0}],props:[{slot:0,drawable:-1,texture:0}]});
export function profile(overrides = {}) {
  const now = new Date().toISOString();
  return {profileVersion:1,characterId:randomUUID(),revision:1,name:'Alex Rivera',nicknames:[],gender:'male',ageBand:'older',modelHash:123,appearance:appearance(),biography:'Civilian',personality:{description:'Calm and loyal',traits:['patient']},relationship:{state:'associate',description:''},playerNotes:'',voiceReference:null,status:'available',createdAtUtc:now,updatedAtUtc:now,promotion:{source:'player',ownerAlias:'promoted.' + randomUUID(),promotedAtUtc:now},memories:[],...overrides};
}
export class TestNativeOwner {
  captures = new Map(); owned = new Map(); requests = []; selected; scripted = false; pedSerial = 90;
  constructor(evidence) { this.evidence = evidence; this.selected = this.encounter('17'); }
  encounter(pedId) { return {pedId,encounterId:randomUUID(),actor:{pedId,gender:'male',ageRange:'old',archetypeName:'Civilian'},modelHash:123,appearance:appearance()}; }
  async request(operation,args = {}) {
    this.requests.push({operation,args});
    if (this.scripted && !['inspect','roster'].includes(operation)) throw new Error('scripted_state');
    if (operation === 'capture') { const captureToken = randomUUID(); const owned = [...this.owned.values()].find(item => item.encounterId === this.selected.encounterId); this.captures.set(captureToken,this.selected); return {...this.selected,captureToken,ownerAlias:owned?.ownerAlias || null}; }
    if (operation === 'register') {
      const target = this.captures.get(args.captureToken); this.captures.delete(args.captureToken);
      if (!target || target.encounterId !== this.selected.encounterId) throw new Error('native_stale');
      const existing = this.owned.get(args.ownerAlias); if (existing) { if (existing.encounterId !== target.encounterId) throw new Error('ownership_conflict'); return {...existing,alreadyOwned:true}; }
      const bound = {...target,ownerAlias:args.ownerAlias,ownershipToken:randomUUID(),claim:this.evidence.register(target.pedId,claim({sourceKey:args.ownerAlias}))}; this.owned.set(args.ownerAlias,bound); return bound;
    }
    if (operation === 'inspect') return this.owned.get(args.ownerAlias) || null;
    if (operation === 'roster') return {owned:[...this.owned.values()].map(item => ({ownerAlias:item.ownerAlias,status:'spawned'})),encounters:[this.selected?.encounterId,...[...this.owned.values()].map(item => item.encounterId)].filter(Boolean)};
    if (operation === 'spawn') {
      const existing = this.owned.get(args.ownerAlias); if (existing) return {...existing,alreadyOwned:true};
      const encounter = this.encounter(String(++this.pedSerial));
      const bound = {...encounter,ownerAlias:args.ownerAlias,ownershipToken:randomUUID(),claim:this.evidence.register(encounter.pedId,claim({sourceKey:args.ownerAlias}))}; this.owned.set(args.ownerAlias,bound); return bound;
    }
    const owned = this.owned.get(args.ownerAlias);
    if (!owned || owned.ownershipToken !== args.ownershipToken) throw new Error('native_stale');
    if (['dismiss','despawn','release'].includes(operation)) { this.owned.delete(args.ownerAlias); this.evidence.retire(owned.pedId); }
    return {status:operation};
  }
}
export async function fixture(t,overrides = {}) {
  const root = await directory(t),evidence = overrides.evidence || new TestOwnerEvidence();
  const config = normalizeConfig({speechVoices:['nova','onyx','echo'],persistentIdentity:{enabled:true,mode:'voices',worldProfileId,storePath:path.join(root,'characters.v1.json'),prepareTimeoutMs:1000},promotedCharacters:{enabled:true,storePath:path.join(root,'profiles.v1.json')},...overrides.config},{});
  const identity = new IdentityResolver(config.persistentIdentity,{evidence}),voice = new VoiceResolver(config),native = overrides.native || new TestNativeOwner(evidence);
  const store = overrides.store || new ProfileStore({filePath:config.promotedCharacters.storePath,worldProfileId});
  const service = new CharacterService(config,{identityService:identity,voiceResolver:voice,store,nativeOwner:native});
  await service.initialize(); t.after(() => identity.close()); return {root,config,evidence,identity,voice,native,store,service};
}
