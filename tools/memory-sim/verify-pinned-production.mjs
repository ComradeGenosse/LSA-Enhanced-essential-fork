#!/usr/bin/env node
// Independent W09 A09a/A09b evidence audit. No game, cloud, synthetic SDK or source bypass.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const at=p=>path.resolve(root,p);
const read=p=>readFileSync(at(p));
const digest=b=>createHash('sha256').update(b).digest('hex');
const hash=p=>digest(read(p));
const present=p=>existsSync(at(p));
const command=(bin,args)=>spawnSync(bin,args,{cwd:root,encoding:'utf8',timeout:600000,maxBuffer:16*1024*1024,shell:false});
const g=command('git',['rev-parse','HEAD']);
const headSha=g.status===0?g.stdout.trim():null;
const report={
  schemaVersion:2,kind:'w09-pinned-production-package',headSha,node:process.version,platform:process.platform,
  physicalGta:false,realApiCalls:false,checks:{},gates:{},sourceSha256:{},sdk:{},runs:{}
};
const mark=(key,status,reason,extra={})=>{
  report.checks[key]={status,reason,...extra};
  console.log('W09 '+key+' '+status.toUpperCase()+' '+reason);
};
const readJSON=p=>JSON.parse(read(p).toString('utf8'));
const tail=s=>String(s||'').slice(-6000);
const recordRun=(key,bin,args)=>{
  const p=command(bin,args);
  report.runs[key]={exitCode:p.status,signal:p.signal??null,error:p.error?.message??null,
    stdoutSha256:digest(p.stdout||''),stderrSha256:digest(p.stderr||''),
    stdoutTail:tail(p.stdout),stderrTail:tail(p.stderr)};
  return p;
};
const summarize=(keys)=>keys.every(k=>report.checks[k]?.status==='pass')?'pass':
  keys.some(k=>report.checks[k]?.status==='fail')?'fail':'blocked';
const bundle='lsa-essential-e1-candidate/upstream/server.bundle.mjs';
const dll='lsa-essential-e1-candidate/upstream/LosSantosAlive.dll';
const hooks='lsa-essential-e1-candidate/patches/essential-hooks.json';
const builder='lsa-essential-e1-candidate/tools/buildCandidate.mjs';
const dist='lsa-essential-e1-candidate/dist/plugins/LosSantosAliveServer/';
const checks=[];
const add=(k,s,m,e={})=>{mark(k,s,m,e);checks.push(k);};
try {
  add('exact-head',/^[a-f0-9]{40}$/.test(headSha||'')?'pass':'fail','git HEAD is a full exact commit SHA');
  const sourceManifest=readJSON(hooks);
  const buildSource=read(builder).toString('utf8');
  report.sourceSha256[hooks]=hash(hooks);
  report.sourceSha256[builder]=hash(builder);
  const builderBundle=/const expectedBundleHash = '([a-f0-9]{64})'/.exec(buildSource)?.[1];
  const builderDll=/const expectedDllHash = '([a-f0-9]{64})'/.exec(buildSource)?.[1];
  for(const [key,rel,want] of [
    ['original-bundle',bundle,sourceManifest.upstreamBundleSha256],
    ['original-dll',dll,sourceManifest.stockDllSha256]]) {
    const got=present(rel)?hash(rel):null;
    report.sourceSha256[rel]=got;
    add(key,got===want&&!!got?'pass':got?'fail':'blocked',
      'source-level pinned SHA256 expected '+want+' observed '+got);
  }
  add('original-build-pin-consistency',
    builderBundle===sourceManifest.upstreamBundleSha256 && builderDll===sourceManifest.stockDllSha256?'pass':'fail',
    'builder original input pins must equal independent versioned hook manifest');
  const compiledHooks=sourceManifest.patches;
  const unique=new Set((compiledHooks||[]).map(x=>x.id));
  const wellFormed=Array.isArray(compiledHooks)&&compiledHooks.length>0&&
    unique.size===compiledHooks.length&&compiledHooks.every(x=>typeof x.id==='string'&&
      Number.isSafeInteger(x.sourceStart)&&Number.isSafeInteger(x.sourceEnd)&&
      Number.isSafeInteger(x.expected)&&x.expected>0&&x.sourceStart>=0&&x.sourceEnd>=x.sourceStart);
  add('source-patch-manifest',wellFormed?'pass':'fail','versioned IDs, original source ranges and expected occurrences');
  const manifestPath=dist+'build-manifest.json',entry=dist+'server.bundle.mjs';
  const staged=present(manifestPath)&&present(entry);
  const m=staged?readJSON(manifestPath):null;
  const patchList=m?.astPatches;
  const actualPatches=Array.isArray(patchList)?patchList:[];
  const actualCount=actualPatches.length;
  const intendedCount=wellFormed?compiledHooks.reduce((n,x)=>n+x.expected,0):null;
  const editMatches=wellFormed&&actualPatches.length===intendedCount&&
    compiledHooks.every(p=>actualPatches.filter(a=>a.label===p.id&&
      a.start===p.sourceStart&&a.end===p.sourceEnd).length===p.expected);
  // Emit actual source offsets for review when the independently pinned AST
  // inventory drifts. Never treat an unlisted hook as approved automatically.
  if(staged && !editMatches){
    const missing=actualPatches.filter(a=>!compiledHooks?.some(p=>
      p.id===a.label && p.sourceStart===a.start && p.sourceEnd===a.end));
    const stale=compiledHooks?.filter(p=>actualPatches.filter(a=>
      a.label===p.id && a.start===p.sourceStart && a.end===p.sourceEnd).length!==p.expected);
    console.log('W09 unreviewed AST edits '+JSON.stringify(missing.map(a=>({id:a.label,sourceStart:a.start,sourceEnd:a.end,expected:1}))));
    console.log('W09 stale AST edit pins '+JSON.stringify(stale||[]));
  }
  add('independent-ast-hook-reconciliation',!staged?'blocked':editMatches?'pass':'fail',
    'independent source manifest '+intendedCount+' expected edits; built manifest '+actualCount+
    ' edits; IDs and original byte ranges must reconcile (K owns AST/manifest revisions)',
    {expectedCount:intendedCount,actualCount});
  const builtOK=staged&&m.upstreamBundleSha256===sourceManifest.upstreamBundleSha256&&
    m.stockDllReferenceSha256===sourceManifest.stockDllSha256&&
    m.astPatchCount===actualCount&&m.builtBundleSha256===hash(entry)&&
    m.realApiCalls===false&&m.gtaRuntimeTest===false;
  add('pinned-build-manifest',builtOK?'pass':staged?'fail':'blocked',
    'original hashes, output bytes, manifest edit count and offline-only contract');
  if(staged){
    report.sourceSha256[entry]=hash(entry);
    report.sourceSha256[manifestPath]=hash(manifestPath);
    const contents=read(entry).toString('utf8');
    add('original-runtime-import',contents.includes('__LSA_E1_RUNTIME')&&
      contents.includes('createRuntimeForBundle')&&contents.includes('./e1/bootstrap.mjs')?'pass':'fail',
      'patched original runner imports staged runtime, not a sidecar test');
  }else add('original-runtime-import','blocked','staged original runtime unavailable');
  const modules=[
    ['lsa-essential-e1-candidate/src/openai/runSequentialTurn.mjs','e1/openai/runSequentialTurn.mjs'],
    ['lsa-essential-e1-candidate/src/integration/essentialGlue.mjs','e1/integration/essentialGlue.mjs'],
    ['lsa-essential-e1-candidate/src/memory/m2EssentialCapture.mjs','e1/memory/m2EssentialCapture.mjs'],
    ['lsa-shared-brain/src/characters/sqliteProfileStore.mjs','e1/_shared/characters/sqliteProfileStore.mjs'],
    ['lsa-shared-brain/src/memory/m6CursorConsumer.mjs','e1/_shared/memory/m6CursorConsumer.mjs'],
    ['lsa-shared-brain/src/events/m3Ps2ObserverAdapter.mjs','e1/_shared/events/m3Ps2ObserverAdapter.mjs']
  ];
  // Most staged runtime modules must be byte-for-byte identical to source.
  // One source-backed M2 adapter has a single, audited import relocation: the
  // standalone package carries its own _shared tree instead of a repo import.
  // Compare all staged bytes against the *exact* expected transformation;
  // never waive a hash mismatch or trust an arbitrary staged file.
  const approvedRelocations={
    'lsa-essential-e1-candidate/src/memory/m2EssentialCapture.mjs':{
      from:'../../../lsa-shared-brain/src/memory/m2TurnCapture.mjs',
      to:'../_shared/memory/m2TurnCapture.mjs',occurrences:1
    }
  };
  for(const [src,dst] of modules){
    const source=present(src)?read(src):null;
    const stagePath=dist+dst;
    const stagedBytes=present(stagePath)?read(stagePath):null;
    const observed=source?digest(source):null;
    const packaged=stagedBytes?digest(stagedBytes):null;
    let expected=source,relocationValid=true;
    const approved=approvedRelocations[src];
    if(approved && source){
      const input=source.toString('utf8');
      relocationValid=input.split(approved.from).length-1===approved.occurrences &&
        !input.includes(approved.to);
      if(relocationValid) expected=Buffer.from(input.replaceAll(approved.from,approved.to),'utf8');
    }
    const expectedHash=expected?digest(expected):null;
    report.sourceSha256[src]=observed;
    add('staged:'+src,
      source&&stagedBytes&&relocationValid&&packaged===expectedHash?'pass':
        source&&stagedBytes?'fail':'blocked',
      'SHA256 source '+observed+' expected staged '+expectedHash+' staged '+packaged+
      (approved?' (exact audited shared import relocation)':' (byte exact)'));
  }
  const projectPath='native/promoted-characters/PromotedCharacters.csproj';
  const sessionPath='native/session-identity/SessionIdentity.csproj';
  const project=present(projectPath)?read(projectPath).toString('utf8'):null;
  const session=present(sessionPath)?read(sessionPath).toString('utf8'):null;
  add('production-projects',project&&session?'pass':'blocked',
    'original PromotedCharacters and SessionIdentity net481 projects required');
  const compilePaths=project?[...project.matchAll(/<Compile Include="([^"]+)"/g)]
    .flatMap(match=>match[1].split(';'))
    .map(p=>path.posix.normalize(path.posix.join('native/promoted-characters',p)))
    .filter(p=>!p.includes('$(')):[];
  const compileSet=new Set(compilePaths);
  add('production-compile-list',project&&compilePaths.length>0&&
    compilePaths.every(p=>present(p))?'pass':'fail',
    'all explicit .csproj Compile Includes must resolve to real compiled files');
  const inventoryPath='tools/memory-sim/closure-native-producers.v1.json';
  const inventory=readJSON(inventoryPath);
  const required=['C01-dual-source-input-and-native-owner','M3-authenticated-source-time-owner',
    'M7-native-idle-and-priority','M9-gta-event-original-director'];
  const structurallyValid=inventory.schemaVersion===2&&inventory.productionProject===projectPath&&
    Array.isArray(inventory.required)&&inventory.required.length===4&&
    required.every(id=>inventory.required.filter(x=>x.id===id).length===1);
  add('producer-inventory-contract',structurallyValid?'pass':'fail',
    'v2 C01 backend accepted input and independently proven native owner, plus M3/M7/M9');
  for(const id of required) {
    const item=inventory.required?.find(x=>x.id===id);
    const paths=item?.sourcePaths;
    const valid=Array.isArray(paths)&&paths.length>0&&paths.every(p=>typeof p==='string'&&
      p.startsWith('native/')&&!p.includes('..')&&compileSet.has(p)&&present(p)&&
      read(p).length>=(item.minimumCompilableSourceBytes||128));
    report.sourceSha256['producer:'+id]=(paths||[]).filter(p=>typeof p==='string'&&present(p))
      .map(p=>({path:p,sha256:hash(p),compiled:compileSet.has(p)}));
    add('compiled-producer:'+id,valid?'pass':'blocked',
      'K must inspect genuine registered game-fiber producer; production compile path alone does not prove source authority');
    if(id.startsWith('C01-')){
      const backend=item?.backendAcceptedSourcePaths;
      const ok=Array.isArray(backend)&&backend.length>0&&backend.every(p=>
        typeof p==='string'&&p.startsWith('lsa-essential-e1-candidate/')&&
        !p.includes('..')&&present(p));
      add('backend-C01-accepted-input-source',ok?'pass':'blocked',
        'original backend POST-acceptance typed/STT proof required separately from native player/owner corroboration');
    }
  }
  const rphPath=process.env.W09_RPH_DLL_PATH||'';
  const damagePath=process.env.W09_DAMAGE_DLL_PATH||'';
  const validSdk=(name,p,digestExpected)=>{
    const expected=String(digestExpected||'').toLowerCase();
    const approved=/^[a-f0-9]{64}$/.test(expected);
    const allowed=p&&path.isAbsolute(p)&&path.basename(p).toLowerCase()===(name==='rph'?'ragepluginhook.dll':'damagetrackerlib.dll')&&
      // CI uses an ephemeral staging directory. Never read an arbitrary GTA installation.
      p.split(/[\\/]/).some(segment=>segment==='w09-approved-sdk');
    const got=allowed&&existsSync(p)?digest(readFileSync(p)):null;
    report.sdk[name]={status:approved&&got===expected?'pass':'blocked',
      approvedHash:approved?expected:null,observedHash:got,
      referenceName:name==='rph'?'RagePluginHook.dll':'DamageTrackerLib.dll',
      source:'external-approved-compile-only-reference',packaged:false};
    return approved&&got===expected;
  };
  const rph=validSdk('rph',rphPath,process.env.W09_RPH_DLL_SHA256);
  const damage=validSdk('damage',damagePath,process.env.W09_DAMAGE_DLL_SHA256);
  add('approved-external-SDK',rph&&damage?'pass':'blocked',
    rph&&damage?'both approved compile-only DLL bytes verified':
      'MISSING_EXTERNAL_PINNED_SDK: approved RPH and DamageTracker references/hashes not supplied');
  if(rph&&damage&&process.platform==='win32') {
    const args=['build',projectPath,'--configuration','Release','-p:Deterministic=true',
      '-p:RphReferencePath='+rphPath,'-p:DamageReferencePath='+damagePath,'-v:minimal'];
    const result=recordRun('production-net481-compile','dotnet',args);
    add('native-production-compile',result.status===0?'pass':'fail',
      'original net481 main project and referenced SessionIdentity project; inspect stdout/stderr receipt');
  }else add('native-production-compile','blocked',
    rph&&damage?'native compilation requires Windows runner':'MISSING_EXTERNAL_PINNED_SDK');
  const tests=[['abi','tools/essential-abi/EssentialAbi.csproj'],
    ['native-authority','native/intelligence/memory-authority-tests/MemoryAuthorityTests.csproj'],
    ['native-M9','native/intelligence/m9-tests/M9NativeTests.csproj'],
    ['native-PS6','native/intelligence/director-tests/DirectorTests.csproj']];
  for(const [name,proj] of tests){
    if(process.platform!=='win32'){add('native-policy:'+name,'blocked','net481 policy executable requires Windows');continue;}
    const p=recordRun('native-policy:'+name,'dotnet',['run','--project',proj,'--configuration','Release']);
    add('native-policy:'+name,p.status===0?'pass':'fail',
      'original standalone policy harness; NEVER evidence of a registered GTA producer',
      {stdoutTail:tail(p.stdout),stderrTail:tail(p.stderr),exitCode:p.status});
  }
} catch(error) {
  mark('verifier-unhandled-exception','fail',String(error?.stack||error));
}
const groups={
  packaging:['exact-head','original-bundle','original-dll','original-build-pin-consistency',
    'source-patch-manifest','independent-ast-hook-reconciliation','pinned-build-manifest',
    'original-runtime-import',...Object.keys(report.checks).filter(x=>x.startsWith('staged:'))],
  productionCompile:['production-projects','production-compile-list','approved-external-SDK',
    'native-production-compile'],
  nativePolicies:['native-policy:abi','native-policy:native-authority','native-policy:native-M9','native-policy:native-PS6'],
  requiredProducers:['producer-inventory-contract',...Object.keys(report.checks)
    .filter(x=>x.startsWith('compiled-producer:')||x==='backend-C01-accepted-input-source')]
};
for(const [k,v] of Object.entries(groups))report.gates[k]={status:summarize(v),checks:v};
report.gates.originalRunner={status:'blocked',reason:'A10 is independently verified by closure-acceptance-replay.mjs; this package audit cannot assert S01-S10'};
report.status=Object.values(groups).every(keys=>summarize(keys)==='pass')?'pass':
  Object.values(groups).some(keys=>summarize(keys)==='fail')?'fail':'blocked';
const out=at('artifacts/memory-k/w09-pinned-package-receipt.json');
mkdirSync(path.dirname(out),{recursive:true});
writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log('W09 evidence gates '+JSON.stringify(Object.fromEntries(Object.entries(report.gates).map(([k,v])=>[k,v.status]))));
console.log('W09 receipt '+out+' SHA '+headSha+' '+report.status);
if(report.status!=='pass')process.exitCode=1;
