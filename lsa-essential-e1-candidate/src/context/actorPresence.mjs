// Presence evidence stays outside normalized actor JSON. Essential's defaults
// cannot be used as proof that a physical field was supplied by the producer.
const fields=['gender','ageRange','isArmed','isIndoors','hasHeldItem','heldItemName'];
const own=(value,key)=>Object.hasOwn(value||{},key);
const mappings={actor:{gender:['pedGender'],ageRange:['pedAgeRange'],isArmed:['pedArmed'],isIndoors:['isIndoors'],hasHeldItem:['hasHeldItem','pedHasHeldItem'],heldItemName:['heldItemName','pedHeldItemName']},hydrated:{isArmed:['isArmed','armed']},listener:{gender:['playerGender'],ageRange:['playerAgeRange'],isArmed:['playerArmed'],isIndoors:['isIndoors'],hasHeldItem:['playerHasHeldItem'],heldItemName:['playerHeldItemName']}};
function supplied(raw,keys,nullish=false){
 const present=keys.filter(key=>own(raw,key)&&raw[key]!==undefined&&raw[key]!==null);
 // AO aliases use JavaScript's ||. Preserve its actual selected input rather
 // than treating a different typed alias as proof for a malformed winner.
 const winner=nullish?present[0]:present.find(key=>Boolean(raw[key]))??present[0];return winner===undefined?undefined:raw[winner];
}
function known(field,value,normalized){
 if(['isArmed','isIndoors','hasHeldItem'].includes(field))return typeof value==='boolean'&&value===normalized;
 if(field==='gender')return typeof value==='string'&&['male','female','unknown'].includes(value)&&value===normalized;
 if(field==='ageRange')return typeof value==='string'&&['young','middle-aged','old','unknown'].includes(value)&&value===normalized;
 return typeof value==='string'&&value===normalized;
}
export class ActorPresenceStore {
 #values=new WeakMap();
 #remember(actor,presence){this.#values.set(actor,{presence:Object.freeze(presence),values:Object.fromEntries(presence.map(key=>[key,actor[key]]))});return actor;}
 capture(normalized,raw,shape='direct'){
  if(!normalized||typeof normalized!=='object')return normalized;
  const previous=raw&&typeof raw==='object'?this.#values.get(raw):null;
  if(previous)return this.#remember(normalized,this.read(raw).filter(field=>raw[field]===normalized[field]));
  const mapping=mappings[shape];
  const presence=fields.filter(field=>known(field,supplied(raw,mapping?.[field]??[field],shape==='hydrated'),normalized[field]));
  return this.#remember(normalized,presence);
 }
 read(actor){
  const record=actor&&typeof actor==='object'?this.#values.get(actor):null;
  if(!record)return Object.freeze([]);
  return record.presence.every(key=>actor[key]===record.values[key])?record.presence:Object.freeze(record.presence.filter(key=>actor[key]===record.values[key]));
 }
 copy(source,target){if(target&&typeof target==='object')this.#remember(target,this.read(source).filter(key=>source[key]===target[key]));return target;}
}
