// Pinned Acorn AST/source audit: NEVER patches the upstream bundle.
// Presence of input/transcript functions does NOT mean an accepted-turn hook.
import {createHash} from 'node:crypto';
import {parse} from '../../tools/vendor/acorn/dist/acorn.mjs';
import {ORIGINAL_BACKEND_PIN} from './originalBackendAcceptedInput.mjs';

const functions=['ib','lb','wd','ub','$y','Xn','AP','NK','YK','ZP','vi','SK'];
const expectations=Object.freeze({
  ib:['Xi','Zi','Xn','Td','vi','Sd'],
  wd:['Zi','Xn','Td','md'],
  '$y':['A.mic','_d','Py','Sd'],
  AP:['xP','SK'],
  NK:['serverContent','inputTranscription'],
  Xn:['bindGeneration','GENERATION_STARTED'],
  ZP:['HP','Xn'],
  vi:['sendText'],
});
// Fail closed on the actual minified input-admission edges, not merely on
// function names. These are the exact original code paths pinned by the
// complete upstream SHA-256 above. The transport ACK has no final-input
// revision; the transcript event is a mutating merge, not a final acceptance.
const sourcePathWitnesses=Object.freeze([
  Object.freeze({id:'typed_trim_and_fallback',functionName:'ib',
    fragments:Object.freeze(['l=Fr(t.text)||"Hello, what are you doing here?"','await vi(h,d)','Sd(p.id)'])}),
  Object.freeze({id:'typed_transport_submission',functionName:'vi',
    fragments:Object.freeze(['String(e||"").trim()','await t.connection.sendText(n)'])}),
  Object.freeze({id:'mic_activity_end_is_submission',functionName:'$y',
    fragments:Object.freeze(['await _d(e)','Py(t.id)','Sd(t.id)'])}),
  Object.freeze({id:'stt_transcript_no_final_marker',functionName:'NK',
    fragments:Object.freeze(['n.inputTranscription?.text','Ee.INPUT_TRANSCRIPT','n.turnComplete&&e.push'])}),
  Object.freeze({id:'transcript_merge_is_mutable',functionName:'AP',
    fragments:Object.freeze(['case Ee.INPUT_TRANSCRIPT:return e.input.transcript=SK(e.input.transcript,t.text)',
      'case Ee.TURN_COMPLETE:return await wP(e)'])}),
  Object.freeze({id:'fragment_merger',functionName:'SK',
    fragments:Object.freeze(['e.startsWith(t)?e','t+e'])}),
  Object.freeze({id:'misnamed_recovery_timestamp',functionName:'YK',
    fragments:Object.freeze(['t.type==="input_transcript"','n.providerAcceptedInputAt=Date.now()'])}),
  Object.freeze({id:'recovery_replays_on_new_generation',functionName:'ZP',
    fragments:Object.freeze(['Xn(e.id,{sessionRecord:r,generationId:i,recovery:!1})',
      'await vi(r,t.text)','await _d(r)'])}),
  Object.freeze({id:'generation_binding_precedes_transport',functionName:'Xn',
    fragments:Object.freeze(['le.bindGeneration(i.id,{generationId:n,sessionNonce:e.nonce})',
      'pt(Pe.GENERATION_STARTED,i'])}),
]);

function visit(node,callback){
  if(!node||typeof node!=='object')return;
  if(typeof node.type==='string')callback(node);
  for(const [k,v] of Object.entries(node)){
    if(k==='start'||k==='end'||k==='loc'||k==='range')continue;
    if(Array.isArray(v))v.forEach(n=>visit(n,callback));
    else if(v&&typeof v==='object')visit(v,callback);
  }
}
export function auditPinnedOriginalBackendSource(source){
  if(typeof source!=='string')throw new TypeError('original_source_must_be_text');
  const observedSha=createHash('sha256').update(Buffer.from(source,'utf8')).digest('hex');
  if(observedSha!==ORIGINAL_BACKEND_PIN.originalBundleSha256)
    return Object.freeze({status:'rejected',reason:'pinned_source_hash_mismatch',observedSha});
  const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
  const located=new Map();
  visit(ast,node=>{
    if(node.type==='FunctionDeclaration'&&functions.includes(node.id?.name)){
      if(located.has(node.id.name))throw new Error('duplicate_original_function:'+node.id.name);
      located.set(node.id.name,node);
    }
  });
  const absent=functions.filter(name=>!located.has(name));
  if(absent.length)
    return Object.freeze({status:'rejected',reason:'original_ast_anchor_missing',
      missing:Object.freeze(absent)});
  const anchors={};
  for(const name of functions){
    const node=located.get(name),body=source.slice(node.start,node.end);
    if((expectations[name]||[]).some(fragment=>!body.includes(fragment)))
      return Object.freeze({status:'rejected',reason:'original_ast_semantics_changed',functionName:name});
    anchors[name]=Object.freeze({
      start:node.start,end:node.end,
      sha256:createHash('sha256').update(body).digest('hex'),
    });
  }
  for(const witness of sourcePathWitnesses){
    const node=located.get(witness.functionName);
    const body=source.slice(node.start,node.end);
    if(witness.fragments.some(fragment=>!body.includes(fragment)))
      return Object.freeze({status:'rejected',reason:'original_input_path_changed',
        witnessId:witness.id,functionName:witness.functionName});
  }
  const observedInputPaths=Object.freeze(sourcePathWitnesses.map(witness=>Object.freeze({
    pathId:witness.id,
    functionName:witness.functionName,
    sourceAnchorSha256:anchors[witness.functionName].sha256,
    permitsFinalAcceptedReceipt:false,
  })));
  // Audited: typed ib -> trimmed vi send; mic $y -> activityEnd;
  // NK -> inputTranscription.text without final marker;
  // AP -> input_transcript SK fragment merge; YK uses misleading
  // providerAcceptedInputAt variable. NO genuine final accept transition.
  return Object.freeze({
    status:'source_verified_missing_capability',
    sourceRevision:ORIGINAL_BACKEND_PIN.sourceRevision,
    sha256:observedSha,anchors:Object.freeze(anchors),
    originalPostAcceptanceHook:false,
    typedFinalExactBytes:false,
    sttFinalAcceptedIndicator:false,
    observedInputPaths,
    blocker:'No original post-acceptance event carrying final typed/STT bytes plus immutable turn identity and monotonic accepted revision',
  });
}
