import { writeFile, readdir, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CAPABILITY_IDS, ACT3_CAPABILITY_IDS, ACT6_CAPABILITY_IDS } from '../activities/contracts.mjs';
import { loadCapabilityRegistry } from '../activities/capabilityRegistry.mjs';
import { MEMORY_K_CAPABILITIES } from '../memory/capabilityPolicy.mjs';
import { HEALTH_CAPABILITIES } from './capabilityHealth.mjs';
import { REACTION_NAMES, OPT_IN_REACTION_NAMES } from '../reactions/reactionCatalog.mjs';

// OBS2 is an inventory + bounded event observer, NOT a health polling service.
// Keep these companion/runtime categories in sync with newly implemented core
// systems; ACT/Memory/Reaction capability rows derive from their real registries.
export const SYSTEM_HEALTH_SCHEMA = 1;
export const CORE_SYSTEMS = Object.freeze([
  'native.rph','native.p2','native.f11','native.enhanced',
  'companion.service','companion.bridge','companion.telemetry','companion.editor',
  'conversation.ux4','conversation.stt','conversation.luna','conversation.tts',
  'conversation.playback','conversation.history','conversation.turn','conversation.voiceFallback',
  'scene.director','scene.spontaneous','scene.social',
  'perception.ps0','perception.ps1','perception.ps2','perception.ps3','perception.ps4','perception.ps5','perception.ps6',
  'identity.persistent','character.promotion','character.ownership',
  'emotion.acting','reaction.transport','activity.transport',
  'activity.act0','activity.act1','activity.act2','activity.act3','activity.act4','activity.act5','activity.act6',
  'memory.sqlite','memory.recall','memory.privacy','memory.m7','memory.m9',
]);
// These names are verified by a source-inventory regression. Ownership of an
// IDisposable is evidence of initialization only, never operational proof.
export const BOOTSTRAP_RESOURCES = Object.freeze([
  'acceptance.boundary','acceptance.host','act5','activities','authority.d02',
  'dialogueTrace','director.pump','director.subscription','emotion.host','emotion.world',
  'essential.connections','essential.revocation','m7.boundary','m7.host',
  'm7.idleAuthority','m7.idleSource','m9.callbacks.boundary','m9.callbacks.host',
  'memory.cloudCuration','memory.m3','memory.m9Callbacks','memory.retention',
  'p1.identity','p2.editor','p2.storage','process.beforeExit','reactions',
  'source.intelligence','storage.source','telemetry','obs2.health',
]);

const idSafe = id => typeof id === 'string' && /^[a-z][A-Za-z0-9_.-]{1,79}$/.test(id);
const modeSafe = mode => ['off','on','shadow','experimental','active','openai','elevenlabs','gemini','auto','unspecified','unknown'].includes(mode) ? mode : 'unknown';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BOUNDED_MANIFEST = /^obs2-inventory-[0-9a-f-]{36}\.jsonl$/;

function coreMode(id, config) {
  if (id === 'companion.telemetry') return config.observabilityEnabled === false ? 'off' : 'on';
  if (id === 'companion.editor') return config.promotedCharacters?.enabled === false ? 'off' : 'auto';
  if (id === 'conversation.voiceFallback') return config.localVoiceFallback?.enabled===true?'on':
    config.localVoiceFallback?.enabled===false?'off':'unknown';
  if (id.startsWith('conversation.')) return id === 'conversation.tts' ? modeSafe(config.speechProvider) :
    id === 'conversation.luna' ? modeSafe(config.provider) : 'auto';
  if (id.startsWith('scene.')) return modeSafe(config.spontaneousSpeech?.mode ?? 'off');
  if (id.startsWith('perception.')) return modeSafe(config.intelligence?.mode ?? 'off');
  if (id.startsWith('activity.')) return id === 'activity.act5' && config.activities?.act5 !== true
    ? 'off' : modeSafe(config.activities?.mode ?? 'off');
  if (id.startsWith('reaction.')) return modeSafe(config.reactions?.mode ?? 'off');
  if (id === 'identity.persistent') return config.persistentIdentity?.enabled ? 'on' : 'off';
  if (id.startsWith('character.')) return config.promotedCharacters?.enabled ? 'on' : 'off';
  if (id.startsWith('emotion.')) return config.actingEnabled ? 'on' : 'auto';
  if (id === 'memory.m7') return modeSafe(config.memoryK?.capabilities?.['memory.cloudCuration'] ?? 'off');
  if (id === 'memory.m9') return modeSafe(config.memoryK?.capabilities?.['memory.callbacks'] ?? 'off');
  if (id.startsWith('memory.')) return config.promotedCharacters?.enabled ? 'auto' : 'off';
  return 'auto';
}
function resourceMode(name, config) {
  if (name.startsWith('director.')) return modeSafe(config.spontaneousSpeech?.mode ?? 'off');
  if (name === 'activities') return modeSafe(config.activities?.mode ?? 'off');
  if (name === 'reactions') return modeSafe(config.reactions?.mode ?? 'off');
  if (name === 'memory.retention') return modeSafe(config.memoryK?.capabilities?.['memory.deterministic'] ?? 'off');
  if (name === 'memory.cloudCuration') return modeSafe(config.memoryK?.capabilities?.['memory.cloudCuration'] ?? 'off');
  if (name === 'memory.m9Callbacks') return modeSafe(config.memoryK?.capabilities?.['memory.callbacks'] ?? 'off');
  if (name === 'source.intelligence') return modeSafe(config.intelligence?.mode ?? 'off');
  if (name === 'p2.storage' || name === 'p2.editor') return config.promotedCharacters?.enabled ? 'auto' : 'off';
  if (name === 'p1.identity') return config.persistentIdentity?.enabled ? 'on' : 'off';
  return 'auto';
}

// All rows are code/registry declarations, NOT assertions that a native DLL
// was installed or that a system completed any gameplay operation.
export function buildSystemInventory(config = {}, registry) {
  // Some installed bundles lack the source activity-contract JSON. That must
  // produce an honest implementation-evidence gap, never lose the inventory
  // or prevent LSA startup. Registry IDs still come from the compiled contract.
  if (registry === undefined) try { registry=loadCapabilityRegistry(); } catch { registry=null; }
  const rows = new Map();
  const add = (id, family, configuredMode, implemented = true, dependencies = []) => {
    if (!idSafe(id) || rows.has(id)) throw new Error('obs2_inventory_duplicate_or_invalid_id');
    rows.set(id, Object.freeze({id,family,configuredMode:modeSafe(configuredMode),
      implemented:implemented === true ? true : implemented === false ? false : 'unknown',
      installed:'unknown',initialization:'unknown',
      dependencies:Object.freeze([...dependencies]),source:'code_registry'}));
  };
  for (const id of CORE_SYSTEMS) add(id,id.split('.')[0],coreMode(id,config));
  for (const name of BOOTSTRAP_RESOURCES) add('resource.' + name,'resource',resourceMode(name,config));
  for (const descriptor of MEMORY_K_CAPABILITIES) {
    const explicit = config.memoryK?.capabilities;
    const requested = descriptor.kind === 'prerequisite' ? 'auto'
      : explicit && Object.keys(explicit).length ? (explicit[descriptor.id] ?? 'off')
        : 'unspecified'; // Legacy wiring is NOT proved off by an absent request.
    add('mk.' + descriptor.id,'memory_k',requested,descriptor.support !== 'absent',
      descriptor.dependencies.map(id => 'mk.' + id));
  }
  for (const id of CAPABILITY_IDS) {
    const row = registry.get(id);
    const phase = row?.phase ?? (ACT6_CAPABILITY_IDS.includes(id) ? 'ACT6'
      : ACT3_CAPABILITY_IDS.includes(id) ? 'ACT3' : 'ACT2');
    const mode = config.activities?.mode !== 'on' ? (config.activities?.mode ?? 'off') :
      phase === 'ACT3' && !config.activities?.act3Capabilities?.includes(id) ? 'off' :
      phase === 'ACT6' && !config.activities?.act6Capabilities?.includes(id) ? 'off' : 'on';
    const implemented = row ? row.phase !== 'never' && row.execution.path !== 'none' : 'unknown';
    add('act.' + id,'activity_capability',mode,implemented);
  }
  for (const id of REACTION_NAMES) {
    const optedOut = OPT_IN_REACTION_NAMES.includes(id) && !config.reactions?.enabled?.includes(id);
    add('reaction.' + id,'reaction_capability',optedOut ? 'off' : config.reactions?.mode ?? 'off');
  }
  for (const id of HEALTH_CAPABILITIES) add('readiness.' + id,'capability_health','unknown');
  return Object.freeze([...rows.values()]);
}

const sourceId = (name, inventory) => {
  const id = 'resource.' + name;
  return inventory.has(id) ? id : null;
};

// Only real provider/native/engine terminal events can supply operational
// proof. A successful hello, dispatch or generated PCM cannot do so.
export function evidenceFromTelemetry(record) {
  const e=record?.event,d=record?.data||{};
  if (e === 'intelligence_status') {
    const state=({connecting:'initializing',connected:'connected',initialized:'ready',
      disconnected:'disconnected',owner_stalled:'degraded',owner_resumed:'ready'})[d.stage];
    return state ? {id:'perception.ps0',state,proof:'transport'} : null;
  }
  if (e === 'target_changed') return {id:'conversation.ux4',state:'ready',proof:'source_event'};
  if (e === 'knowledge_frame_projected') return {id:'perception.ps4',state:'verified',proof:'frame_projected'};
  if (e === 'stt_completed') return {id:'conversation.stt',state:'verified',proof:'provider_result'};
  if (e === 'bridge_ready') return {id:'companion.bridge',state:'ready',proof:'transport'};
  if (e === 'bridge_disconnected') return {id:'companion.bridge',state:'disconnected',proof:'transport'};
  if (e === 'reaction_channel_ready') return {id:'reaction.transport',state:'ready',proof:'transport'};
  if (e === 'reaction_channel_closed') return {id:'reaction.transport',state:'disconnected',proof:'transport'};
  if (e === 'reaction_channel_mode_mismatch') return {id:'reaction.transport',state:'blocked',proof:'transport',code:'mode_mismatch'};
  if (e === 'activity_channel_failure') return {id:'activity.transport',state:'degraded',proof:'transport',code:d.code};
  if (e === 'activity_channel_ready') return {id:'activity.transport',state:'ready',proof:'transport'};
  if (e === 'activity_channel_closed') return {id:'activity.transport',state:'disconnected',proof:'transport'};
  if (e === 'activity_terminal' && d.status === 'completed' && d.proofLevel === 'world_strong'
    && typeof d.capability === 'string') return {
      id:'act.' + d.capability,state:'verified',proof:'world_strong',operationId:d.activityId};
  if (e === 'voice_fallback_playback_completed') return {
    id:'conversation.voiceFallback',state:'verified',proof:'native_terminal'};
  if (e === 'voice_fallback_playback_failed') return {
    id:'conversation.voiceFallback',state:'degraded',proof:'native_terminal',
    code:'fallback_delivery_failed'};
  if (e === 'memory_journal_committed') return {id:'mk.memory.events',state:'verified',proof:'durable_write'};
  if (e === 'assistant_history_committed') return {id:'conversation.history',state:'verified',proof:'history_commit'};
  if (e === 'native_playback_ended' &&
      (d.status === 'completed' || d.outcome === 'completed')) return {
        id:'conversation.playback',state:'verified',proof:'native_terminal'};
  if (e === 'provider_request_finished' && d.outcome === 'finished' &&
      ['stt','model','tts'].includes(d.operation)) return {
        id:'conversation.' + (d.operation === 'model' ? 'luna' : d.operation),
        state:'verified',proof:'provider_result'};
  return null;
}

export function createSystemHealthMonitor({config,telemetry,now=()=>new Date().toISOString(),
  inventory=buildSystemInventory(config),maxTransitions=512}={}) {
  const rows = new Map(inventory.map(row=>[row.id,row]));
  const states = new Map();
  let transitionCount=0,closed=false,gapReported=false;
  function note(id,state,{code,proof='none',evidenceEvent,operationId,identity,context={}}={}) {
    if(closed || !rows.has(id) || !['initializing','initialized','ready','connected',
        'disconnected','degraded','blocked','verified','stopped','unknown'].includes(state))return false;
    const current=states.get(id);
    // Idempotent state reporting, no repetitive health events per frame.
    if(current?.state===state && current.proof===proof && current.code===(code||null))return false;
    const next=Object.freeze({state,proof,code:code||null,lastTransitionAt:now(),
      lastEvidenceEvent:evidenceEvent||null,
      lastSuccessfulOperation:state==='verified' ? Object.freeze({
        at:now(),proof,event:evidenceEvent||null,operationId:operationId||null
      }) : current?.lastSuccessfulOperation??null});
    states.set(id,next);
    if(++transitionCount>maxTransitions){
      if(!gapReported){
        gapReported=true;
        try{telemetry?.emit?.('system_health_gap',null,'internal',
          {code:'transition_limit_exceeded'},'internal',
          {component:'observability',severity:'warn'});}catch{}
      }
      return false;
    }
    try { telemetry?.emit?.('system_health',identity||null,'internal',{
      systemId:id,healthState:state,proofLevel:proof,
      ...(code?{code}:{ } ),
      ...(evidenceEvent?{evidenceEvent}:{ }),
      ...(operationId?{activityId:operationId}:{ }),
      ...(context?.hostRunId?{hostRunId:context.hostRunId}:{ }),
      ...(context?.worldEpoch?{worldEpoch:context.worldEpoch}:{ }),
      ...(context?.nativeRun?{nativeRun:context.nativeRun}:{ }),
      ...(context?.adapterEpoch?{adapterEpoch:context.adapterEpoch}:{ }),
    },'internal',{component:'observability',severity:['degraded','blocked','disconnected'].includes(state)?'warn':'info'}); }
    catch { /* best-effort diagnostics never fail gameplay */ }
    return true;
  }
  function onEvent(record) {
    if(closed || record?.event==='system_health')return;
    const evidence=evidenceFromTelemetry(record);
    if(!evidence || !rows.has(evidence.id))return;
    note(evidence.id,evidence.state,{code:evidence.code,proof:evidence.proof,
      evidenceEvent:record.event,identity:record.identity,operationId:evidence.operationId,
      context:record.data});
  }
  function onResource({name,state,reason}) {
    const id=sourceId(name,rows);
    if(!id)return;
    const health=state==='operational'?'initialized':state==='starting'?'initializing':
      state==='failed'?'blocked':state==='stopped'?'stopped':'unknown';
    note(id,health,{code:reason || undefined,proof:'resource_lifecycle'});
    if(name==='p2.storage')note('memory.sqlite',health,{code:reason||undefined,proof:'resource_lifecycle'});
    if(name==='source.intelligence' && state==='failed')
      note('perception.ps0','blocked',{code:'initialization_failed',proof:'resource_lifecycle'});
    if(name==='activities' && state==='failed')
      note('activity.transport','blocked',{code:'initialization_failed',proof:'resource_lifecycle'});
  }
  return Object.freeze({inventory,note,onEvent,onResource,snapshot:()=>Object.freeze({
    inventoryVersion:SYSTEM_HEALTH_SCHEMA,transitionCount,systems:Object.freeze(
      inventory.map(row=>Object.freeze({...row,...(states.get(row.id)||{})})))}),
    close:()=>{note('resource.obs2.health','stopped',{proof:'resource_lifecycle'});closed=true;}});
}

export async function persistSystemInventory({directory,runId,inventory,utc=new Date().toISOString(),
  maxFiles=8}={}) {
  if(!UUID.test(runId)||!directory || !Array.isArray(inventory))throw new TypeError('obs2_invalid_manifest_inputs');
  const file=path.join(path.resolve(directory),'obs2-inventory-' + runId + '.jsonl');
  // This is a code-generated allowlisted summary of effective *modes*. It
  // contains no raw configuration, credentials, dialogue, memory, IDs of NPCs,
  // native payloads or filesystem paths.
  const body={kind:'obs2_system_inventory',schemaVersion:SYSTEM_HEALTH_SCHEMA,runId,
    recordedAt:utc,systems:inventory};
  const line=JSON.stringify(body)+'\n';
  if(Buffer.byteLength(line)>128*1024)throw new Error('obs2_inventory_size_limit');
  await writeFile(file,line,{flag:'wx',mode:0o600});
  // Bound inventory-file retention separately from E1's rotating JSONL sink.
  try{
    const root=path.resolve(directory);
    const own=(await readdir(root)).filter(name=>BOUNDED_MANIFEST.test(name));
    const files=(await Promise.all(own.map(async name=>{
      const info=await lstat(path.join(root,name));
      return info.isFile()&&!info.isSymbolicLink()?{name,mtime:info.mtimeMs}:null;
    }))).filter(Boolean).sort((a,b)=>b.mtime-a.mtime ||
      (a.name===path.basename(file)?-1:b.name===path.basename(file)?1:
        a.name.localeCompare(b.name)));
    for(const entry of files.slice(Math.max(1,maxFiles)))if(entry.name!==path.basename(file))
      await unlink(path.join(root,entry.name)).catch(()=>{});
  }catch{/* Never fail initialization after a valid manifest was written. */}
  return Object.freeze({file,sha256:createHash('sha256').update(line).digest('hex'),
    count:inventory.length});
}
