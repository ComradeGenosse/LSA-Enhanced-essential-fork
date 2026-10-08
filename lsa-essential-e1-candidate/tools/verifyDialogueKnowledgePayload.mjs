import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {candidateRootPath} from './checkIsolation.mjs';
import {perceptionContractSupported} from '../src/perception/nativeSupport.mjs';

const nativeRoot=path.resolve(candidateRootPath(),'../native');
export const KNOWLEDGE_NATIVE_FILES=Object.freeze(['LSA.PromotedCharacters.dll','LSA.PromotedCharacters.Bootstrap.dll','LSA.PromotedCharacters.Runtime.dll','LSA.SessionIdentity.dll']);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
// Compile-source receipt, independent of bin/obj output or local SDK/cache paths.
export async function intelligenceNativeSourceHash(root=nativeRoot){
 const files=[];
 async function collect(directory){
  for(const item of await readdir(directory,{withFileTypes:true})){
   if(item.isSymbolicLink())throw new Error('knowledge_native_source_link');
   if(item.isDirectory() && !['bin','obj','tests'].includes(item.name))await collect(path.join(directory,item.name));
   else if(item.isFile() && /\.(cs|csproj)$/.test(item.name))files.push(path.join(directory,item.name));
  }
 }
 await collect(root);files.sort((a,b)=>path.relative(root,a).localeCompare(path.relative(root,b),'en'));
 const digest=createHash('sha256');
 for(const file of files)digest.update(path.relative(root,file).split(path.sep).join('/')).update('\0').update(await readFile(file)).update('\0');
 return digest.digest('hex');
}
export async function verifyDialogueKnowledgePayload(directory,perceptionContract){
 const contract={available:false,frameVersion:1,hostContextVersion:1,observerIndexVersion:1,observerSituationVersion:1};
 if(directory===undefined)return {contract,nativePayload:null};
 const root=path.resolve(directory),manifest=JSON.parse(await readFile(path.join(root,'build-manifest.json'),'utf8'));
 const versions=manifest.sharedIntelligenceContract;
 if(!versions || ['hostContextVersion','actorCaptureVersion','observerIndexVersion','observerSituationVersion'].some(key=>versions[key]!==1) || !perceptionContractSupported(perceptionContract) || !perceptionContractSupported(manifest.perceptionContract) || manifest.intelligenceSourceSha256!==await intelligenceNativeSourceHash())throw new Error('knowledge_native_payload_contract');
 if(!Array.isArray(manifest.files) || manifest.files.length!==KNOWLEDGE_NATIVE_FILES.length)throw new Error('knowledge_native_payload_files');
 for(const name of KNOWLEDGE_NATIVE_FILES){
  const entry=manifest.files.find(value=>value.name===name);
  const relativePath=name==='LSA.PromotedCharacters.dll'?`plugins/${name}`:`plugins/LSA.PromotedCharacters/${name}`;
  if(!entry || entry.relativePath!==relativePath || entry.sha256!==hash(await readFile(path.join(root,name))))throw new Error('knowledge_native_payload_hash');
 }
 return {contract:{...contract,available:true},nativePayload:{manifestSha256:hash(await readFile(path.join(root,'build-manifest.json'))),sourceSha256:manifest.intelligenceSourceSha256,files:manifest.files.map(({name,relativePath,sha256})=>({name,relativePath,sha256})),gtaRuntimeTest:false}};
}
