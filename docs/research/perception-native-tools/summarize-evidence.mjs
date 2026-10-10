// Compact, reproducible excerpts; full method IL remains in the probe output.
import { readFileSync, writeFileSync } from 'node:fs';
if (process.argv.length !== 5) throw new Error('Usage: node summarize-evidence.mjs <essential.json> <damage.json> <output.json>');
const [essential, damage] = process.argv.slice(2,4).map(p => JSON.parse(readFileSync(p,'utf8')));
const pins = ['9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653', '64816a0d1131a6ec241f8951902b08afaee86fb0f73693399edefe2db8776750'];
if (essential.dllSha256 !== pins[0] || damage.dllSha256 !== pins[1]) throw new Error('Probe input pin mismatch');
const ascii = value => typeof value === 'string' && /^[\x20-\x7e]+$/.test(value);
function excerpt(probe) {
  return probe.types.flatMap(type => type.methods.filter(m => m.body).map(m => ({
    type:ascii(type.name) ? type.name : '[nested scheduler closure]',
    method:ascii(m.name) ? m.name : '[private helper]', token:m.token,
    returns:m.returns, parameters:m.parameters, ilSha256:m.body.ilSha256,
    excerptIsComplete:m.body.instructions.length <= 40,
    instructions:m.body.instructions.filter(i => m.body.instructions.length <= 40 ||
      (/^call/.test(i.op) && ascii(i.operand)) || (/^(ldfld|stfld|ldsfld|stsfld)$/.test(i.op) && ascii(i.operand)))
      .map(i => ({offset:i.offset,op:i.op,operand:ascii(i.operand) ? i.operand : i.operand == null ? null : '[private member]',token:i.token,
        ...(i.value == null ? {} : {value:i.value}), ...(i.targets ? {targets:i.targets} : {})}))
  })));
}
function contracts(probe, wanted) {
  return probe.types.filter(t => wanted.some(name => t.name.endsWith('.'+name) || t.name.endsWith('+'+name)))
    .map(t => ({type:t.name,fields:t.fields,events:t.events,
      methods:t.methods.filter(m => ascii(m.name)).map(({name,token,returns,parameters}) => ({name,token,returns,parameters}))}));
}
const result = {schemaVersion:1, essentialDllSha256:pins[0],damageDllSha256:pins[1],
  boundary:'Static PE metadata/IL only. Excerpts of long methods are call/field evidence, not reconstructed control flow or GTA validation.',
  essentialContracts:contracts(essential,['PerceptionSnapshot','ReflexAwarenessMemory','ReflexAwarenessService','SpecialGeminiTurnRequest','SpecialGeminiTurnScheduler']),
  damageContracts:contracts(damage,['DamageTrackerService','PedTookDamageDelegate','VehTookDamageDelegate','PedDamageInfo','VehDamageInfo','WeaponDamageInfo']),
  essentialMethods:excerpt(essential),damageMethods:excerpt(damage)};
writeFileSync(process.argv[4], JSON.stringify(result,null,2)+'\n');
console.log('Wrote compact static evidence; no game assemblies were executed.');
