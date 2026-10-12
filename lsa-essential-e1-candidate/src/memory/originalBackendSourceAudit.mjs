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
  });
}
