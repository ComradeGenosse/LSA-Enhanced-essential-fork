// M4's narrow, dependency-free Draft 2020-12 assertion for the exact v1
// recall definitions. Rules are read from the contract, not hand-maintained.
import {readFileSync} from 'node:fs';

const contract=JSON.parse(readFileSync(new URL('../../../contracts/memory.v1.json',import.meta.url),'utf8'));
const has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const isObj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const bytes=v=>Buffer.byteLength(JSON.stringify(v),'utf8');

function conforms(value,schema){
  if(schema.$ref){
    const name=schema.$ref.match(/^#\/\$defs\/([A-Za-z][A-Za-z0-9]*)$/)?.[1];
    return !!name&&!!contract.$defs[name]&&conforms(value,contract.$defs[name]);
  }
  if(schema.const!==undefined&&value!==schema.const)return false;
  if(schema.enum&&!schema.enum.includes(value))return false;
  if(schema.oneOf&&schema.oneOf.filter(s=>conforms(value,s)).length!==1)return false;
  if(schema.type){
    if(schema.type==='object'&&!isObj(value))return false;
    if(schema.type==='array'&&!Array.isArray(value))return false;
    if(schema.type==='string'&&typeof value!=='string')return false;
    if(schema.type==='null'&&value!==null)return false;
    if(schema.type==='boolean'&&typeof value!=='boolean')return false;
    if(schema.type==='number'&&(typeof value!=='number'||!Number.isFinite(value)))return false;
    if(schema.type==='integer'&&!Number.isSafeInteger(value))return false;
  }
  if(typeof value==='string'){
    if(schema.minLength!==undefined&&[...value].length<schema.minLength)return false;
    if(schema.maxLength!==undefined&&[...value].length>schema.maxLength)return false;
    if(schema.pattern&&!new RegExp(schema.pattern,'u').test(value))return false;
  }
  if(typeof value==='number'){
    if(schema.minimum!==undefined&&value<schema.minimum)return false;
    if(schema.maximum!==undefined&&value>schema.maximum)return false;
  }
  if(Array.isArray(value)){
    if(schema.minItems!==undefined&&value.length<schema.minItems)return false;
    if(schema.maxItems!==undefined&&value.length>schema.maxItems)return false;
    if(schema.items&&!value.every(x=>conforms(x,schema.items)))return false;
  }
  if(isObj(value)){
    if(schema.required&&!schema.required.every(k=>has(value,k)))return false;
    if(schema.additionalProperties===false&&Object.keys(value).some(k=>!has(schema.properties??{},k)))return false;
    for(const [k,v] of Object.entries(value)){
      if(schema.properties&&has(schema.properties,k)&&!conforms(v,schema.properties[k]))return false;
    }
  }
  return true;
}

export function assertRecallV1(value,definition){
  if(!['recallQuery','recallBundle'].includes(definition)||!conforms(value,contract.$defs[definition]))
    throw new TypeError('m4_invalid_strict_v1_'+definition);
  if(definition==='recallBundle'&&value.totalBytes!==bytes(value))
    throw new TypeError('m4_invalid_recall_byte_accounting');
  return value;
}
export const recallJsonBytes=bytes;

/** The serialized UTF-8 byte count includes the digits of totalBytes itself. */
export function sealRecallBundle(bundle,maxBytes=14336){
  for(let i=0;i<8;i++){
    const size=bytes(bundle);
    if(size===bundle.totalBytes)break;
    bundle.totalBytes=size;
  }
  assertRecallV1(bundle,'recallBundle');
  if(bundle.totalBytes>maxBytes)throw new RangeError('m4_recall_budget_exceeded');
  return bundle;
}
