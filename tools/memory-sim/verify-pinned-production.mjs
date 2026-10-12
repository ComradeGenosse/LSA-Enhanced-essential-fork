#!/usr/bin/env node
// W09 immutable pinned-offline-build audit; does not install or test GTA.
// Run AFTER: (cd lsa-essential-e1-candidate && npm run build)
// and native harnesses; this audit independently requires main native project
// compilation plus actual compiled source registration, not a test-only .csproj.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const file=f=>path.join(root,f);
const read=f=>readFileSync(file(f));
const sha=data=>createHash('sha256').update(data).digest('hex');
const digest=f=>sha(read(f));
const run=(exec,args)=>spawnSync(exec,args,{
  cwd:root,encoding:'utf8',timeout:600000,maxBuffer:16*1024*1024,shell:false
});
const git=run('git',['rev-parse','HEAD']);
const headSha=git.status===0?git.stdout.trim():null;
const output=file('artifacts/memory-k/w09-pinned-package-receipt.json');
const report={
  version:1,kind:'w09-pinned-production-package',
  headSha,platform:process.platform,node:process.version,
  physicalGta:false,realApiCalls:false,checks:{},failures:[],sourceSha256:{}
};
const check=(key,ok,reason)=>{
  report.checks[key]={status:ok?'pass':'blocked',reason};
  if(!ok)report.failures.push(key+': '+reason);
};
const expected={
  bundle:'5d81de4217bd103316a1083e482ded1bddc791314abf671d686036175c0475f2',
  dll:'9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653',
  patchCount:70
};
try {
  check('sha',/^[0-9a-f]{40}$/.test(headSha||''),'exact checked-out Git commit required');
  for(const [name,rel,want] of [
    ['pinned-original-bundle','lsa-essential-e1-candidate/upstream/server.bundle.mjs',expected.bundle],
    ['pinned-original-dll','lsa-essential-e1-candidate/upstream/LosSantosAlive.dll',expected.dll]
  ]){
    const present=existsSync(file(rel));
    const actual=present?digest(rel):null;
    if(actual)report.sourceSha256[rel]=actual;
    check(name,present&&actual===want,'required original SHA256 '+want+'; observed '+actual);
  }
  const buildDir='lsa-essential-e1-candidate/dist/plugins/LosSantosAliveServer/';
  const manifestName=buildDir+'build-manifest.json',entry=buildDir+'server.bundle.mjs';
  const present=existsSync(file(manifestName))&&existsSync(file(entry));
  const manifest=present?JSON.parse(read(manifestName).toString()):null;
  check('pinned-ast-and-build',present&&manifest.upstreamBundleSha256===expected.bundle&&
    manifest.stockDllReferenceSha256===expected.dll&&
    manifest.astPatchCount===expected.patchCount&&
    manifest.builtBundleSha256===digest(entry)&&
    manifest.realApiCalls===false&&manifest.gtaRuntimeTest===false,
    'original pinned AST 70-hook build manifest and built-entry hash must verify');
  if(present){
    const rels=[
      ['lsa-essential-e1-candidate/src/openai/runSequentialTurn.mjs','e1/openai/runSequentialTurn.mjs'],
      ['lsa-essential-e1-candidate/src/integration/essentialGlue.mjs','e1/integration/essentialGlue.mjs'],
      ['lsa-essential-e1-candidate/src/memory/m2EssentialCapture.mjs','e1/memory/m2EssentialCapture.mjs'],
      ['lsa-shared-brain/src/characters/sqliteProfileStore.mjs','e1/_shared/characters/sqliteProfileStore.mjs'],
      ['lsa-shared-brain/src/memory/m6CursorConsumer.mjs','e1/_shared/memory/m6CursorConsumer.mjs'],
      ['lsa-shared-brain/src/events/m3Ps2ObserverAdapter.mjs','e1/_shared/events/m3Ps2ObserverAdapter.mjs']
    ];
    for(const [src,dst] of rels){
      const actual=existsSync(file(src))?digest(src):null;
      const staged=existsSync(file(buildDir+dst))?digest(buildDir+dst):null;
      report.sourceSha256[src]=actual;
      check('packaged:'+src,!!actual&&staged===actual,
        'canonical production module SHA256 must match staged E1 or shared implementation');
    }
    const rawEntry=read(entry).toString('utf8');
    check('original-runner-patched',
      rawEntry.includes('__LSA_E1_RUNTIME')&&rawEntry.includes('createRuntimeForBundle'),
      'verify Essential AST output actually imports original E1 runtime');
  }
  const csproj='native/promoted-characters/PromotedCharacters.csproj';
  const project=existsSync(file(csproj))?read(csproj).toString():null;
  check('native-production-project',!!project,
    'main production native .csproj is required; isolated policy harnesses not enough');
  if(project){
    const nativeFiles=[...project.matchAll(/<Compile Include="([^"]+)"/g)]
      .flatMap(m=>m[1].split(';'))
      .map(p=>path.posix.normalize(path.posix.join('native/promoted-characters',p)))
      .filter(p=>!p.includes('$('));
    const compiled=nativeFiles.filter(p=>existsSync(file(p)));
    check('native-explicit-sources',compiled.length===nativeFiles.length,
      'every Compile Include in original production native project must exist');
    // K supplies the actual, audited production producer paths after merging
    // T1/T2/T7/T8. Unknown symbols are NOT guessed. Each declared file must
    // physically exist AND be compiled by the ORIGINAL production project.
    const inventoryPath='tools/memory-sim/closure-native-producers.v1.json';
    let inventory=null;
    try{inventory=JSON.parse(read(inventoryPath).toString('utf8'));}
    catch{}
    check('native-producer-inventory',
      inventory?.schemaVersion===1&&Array.isArray(inventory.required)&&
      inventory.required.length===4&&inventory.productionProject===csproj,
      'four required producer contracts must be declared by K and reviewed');
    if(inventory?.required){
      for(const item of inventory.required){
        const paths=item.sourcePaths;
        const valid=Array.isArray(paths)&&paths.length>0&&
          paths.every(p=>typeof p==='string'&&p.startsWith('native/')&&
            !p.includes('..')&&compiled.includes(p)&&
            read(p).length>=(item.minimumCompilableSourceBytes??128));
        check('compiled-producer:'+item.id,valid,
          'reviewed native production sourcePaths must be nonempty and compiled via original main .csproj');
        report.sourceSha256['producer:'+item.id]=Array.isArray(paths)?
          paths.filter(p=>typeof p==='string'&&existsSync(file(p))).map(p=>({
            path:p,sha256:digest(p),compiled:compiled.includes(p)
          })):[];
      }
    }
    const nativeBuild=run('dotnet',['build',csproj,'--configuration','Release',
      '-p:Deterministic=true','-v:minimal']);
    report.nativeBuild={
      exitCode:nativeBuild.status??-1,signal:nativeBuild.signal??null,
      stdoutSha256:sha(nativeBuild.stdout||''),stderrSha256:sha(nativeBuild.stderr||''),
      stdoutTail:(nativeBuild.stdout||'').slice(-6000),
      stderrTail:(nativeBuild.stderr||'').slice(-6000)
    };
    check('native-production-compile',nativeBuild.status===0,
      'main native production project must actually compile against pinned dependencies');
  }
  // The baseline native policy harnesses cannot supply authentic GTA source
  // receipts. They are compile/policy checks only.
  for(const [label,proj] of [
    ['abi','tools/essential-abi/EssentialAbi.csproj'],
    ['native-authority','native/intelligence/memory-authority-tests/MemoryAuthorityTests.csproj'],
    ['native-M9','native/intelligence/m9-tests/M9NativeTests.csproj'],
    ['native-PS6','native/intelligence/director-tests/DirectorTests.csproj']
  ]){
    const native=run('dotnet',['run','--project',proj,'--configuration','Release']);
    check('native-policy:'+label,native.status===0,
      'original .NET harness must run, not just be declared');
    report.checks['native-policy:'+label].stdoutSha256=sha(native.stdout||'');
    report.checks['native-policy:'+label].stderrTail=(native.stderr||'').slice(-3000);
  }
}catch(e){
  report.failures.push('audit_exception: '+String(e?.stack||e));
}finally{
  report.status=report.failures.length?'blocked':'pass';
  mkdirSync(path.dirname(output),{recursive:true});
  writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log('W09 pinned receipt '+path.relative(root,output)+
    ' SHA '+(headSha||'UNKNOWN')+' status '+report.status);
  if(report.failures.length)console.error(report.failures.join('\n'));
}
process.exitCode=report.failures.length?1:0;
