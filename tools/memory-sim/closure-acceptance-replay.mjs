#!/usr/bin/env node
// W09 fail-closed acceptance gate. Test-fixture passing != original GTA readiness.
// Usage: node tools/memory-sim/closure-acceptance-replay.mjs
//        node tools/memory-sim/closure-acceptance-replay.mjs --source-sim
//        node tools/memory-sim/closure-acceptance-replay.mjs --output path.json
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const argv=process.argv.slice(2);
const sourceOnly=argv.includes('--source-sim');
const outArg=argv.indexOf('--output');
const output=path.resolve(root,outArg>=0?argv[outArg+1]||'artifacts/memory-k/w09-receipt.json':
  'artifacts/memory-k/w09-receipt.json');
const hash=s=>createHash('sha256').update(s).digest('hex');
const shaFile=file=>hash(readFileSync(path.join(root,file)));
const command=(exe,args,opts={})=>spawnSync(exe,args,{
  cwd:root,encoding:'utf8',timeout:600000,maxBuffer:32*1024*1024,
  shell:false,...opts
});
const git=command('git',['rev-parse','HEAD']);
const headSha=git.status===0?git.stdout.trim():null;
const status=(s,detail)=>({status:s,detail});
const result={
  version:1,kind:'memory-k-w09-source-acceptance',headSha,
  timestampUtc:new Date().toISOString(),node:process.version,platform:process.platform,
  scope:'offline-source-simulation; physical GTA explicitly untested',
  physicalGta:{status:'NOT_RUN',reason:'separate authorization and real GTA installation required'},
  command:process.argv.slice(0).join(' '),
  gates:{},scenarios:{},sourceSimulation:{},
  sourceHashes:{},failures:[]
};
function gate(name,ok,detail){
  result.gates[name]=status(ok?'pass':'blocked',detail);
  if(!ok)result.failures.push(name+': '+detail);
}
function fileText(file){
  try{return readFileSync(path.join(root,file),'utf8');}
  catch{return null;}
}
function requiredSource(file){
  const body=fileText(file);
  if(body!==null)result.sourceHashes[file]=shaFile(file);
  return body;
}
function flush(){
  mkdirSync(path.dirname(output),{recursive:true});
  writeFileSync(output,JSON.stringify(result,null,2)+'\n');
  console.log('W09 receipt: '+path.relative(root,output));
  console.log('W09 exact head: '+(headSha||'UNAVAILABLE'));
  console.log('W09 gates: '+JSON.stringify(result.gates));
  console.log('W09 scenarios: '+JSON.stringify(result.scenarios));
  if(result.failures.length)console.error('W09 NO-GO:\n'+result.failures.join('\n'));
}
try {
  gate('node24',Number(process.versions.node.split('.')[0])===24,
    'Node v24 required for identical Windows/Linux built-in SQLite behavior');
  gate('exact-head',/^[0-9a-f]{40}$/.test(headSha||''),
    'git rev-parse HEAD must resolve to one checked-out production candidate SHA');
  const scenarios=JSON.parse(requiredSource('tools/memory-sim/scenarios.v0.json')||'{}');
  const ids=Array.from({length:10},(_,n)=>'S'+String(n+1).padStart(2,'0'));
  gate('original-M0-manifest',Array.isArray(scenarios.scenarios)&&
    ids.every(id=>scenarios.scenarios.some(s=>s.id===id)) &&
    scenarios.scenarios.length===10,
    'all original S01-S10 entries required without changing their flags');
  const runner=requiredSource('lsa-essential-e1-candidate/src/openai/runSequentialTurn.mjs');
  const glue=requiredSource('lsa-essential-e1-candidate/src/integration/essentialGlue.mjs');
  const p2=requiredSource('lsa-shared-brain/src/characters/sqliteProfileStore.mjs');
  const authority=requiredSource('lsa-essential-e1-candidate/src/memory/nativeMemoryAuthority.mjs');
  const play=requiredSource('lsa-essential-e1-candidate/src/memory/m2EssentialCapture.mjs');
  const m3=requiredSource('lsa-shared-brain/src/events/m3Ps2ObserverAdapter.mjs');
  const m6=requiredSource('lsa-shared-brain/src/memory/m6CursorConsumer.mjs');
  const src=!!runner&&!!glue&&!!p2&&!!authority&&!!play&&!!m3&&!!m6;
  gate('production-module-source',src,'original runner/glue, P2 and M2/M3/M6 real source files must be present');
  // Diagnostic heuristic only, NEVER a substitute for an executed original-runner test.
  result.sourceSimulation.originalRunnerDiagnostic=src?{
    oldM2Binding:glue.includes('createM2TurnCapture'),
    strictM2Binding:glue.includes('createM2EssentialCapture'),
    durableP2Cursor:p2.includes('ackM6Checkpoint'),
    originalRunnerEntry:runner.includes('export async function runSequentialTurn')
  }:{status:'unavailable'};
  const testPath='lsa-shared-brain/tests/memory-k-integrated-replay.test.mjs';
  const run=command(process.execPath,['--test',testPath]);
  result.sourceSimulation={
    ...result.sourceSimulation,classification:'isolated source simulation using real P2 SQLite and test-only native proof',
    command:'node --test '+testPath,
    exitCode:run.status??-1,stdoutSha256:hash(run.stdout||''),
    stderrSha256:hash(run.stderr||''),signal:run.signal||null,
    // Keep logs paired with this exact checkout for failed-gate investigation.
    stdoutTail:(run.stdout||'').slice(-10000),stderrTail:(run.stderr||'').slice(-8000)
  };
  gate('P2-source-simulation',run.status===0,'201+ dialogue and 2501+ sidecar-backed events, source fences, restart, privacy and rollback');
  if(sourceOnly){
    gate('source-simulation-only-not-production',true,
      'explicitly opted out of A10; do not use this receipt to mark any S01-S10 implemented');
  } else {
    // Original runner integration tests must each execute on THIS checkout, not
    // merely read an earlier agent handoff or set scenarios.v0.json true.
    // K/T1..T8 may contribute the exact source tests at these stable locations.
    for(const id of ids) {
      const scenarioFile='lsa-essential-e1-candidate/tests/memory-k-original-'+id+'.test.mjs';
      const body=requiredSource(scenarioFile);
      if(!body){
        result.scenarios[id]=status('blocked','MISSING_ORIGINAL_RUNNER_TEST: '+scenarioFile);
        result.failures.push(id+': missing source-bound original-runner integration test');
        continue;
      }
      // An isolated mocked component file cannot be silently promoted to A10.
      const importsRunner=body.includes('runSequentialTurn')||body.includes('createRuntime');
      const importsP2=body.includes('sqliteProfileStore.mjs')||
        body.includes('memoryStorageAdapter.mjs');
      if(!importsRunner||!importsP2){
        result.scenarios[id]=status('blocked','NOT_ORIGINAL_RUNNER_AND_P2_SOURCE');
        result.failures.push(id+': original runner and P2 source imports required');
        continue;
      }
      const child=command(process.execPath,['--test',scenarioFile],{
        env:{...process.env,MEMORY_K_EXPECTED_HEAD_SHA:headSha||''}
      });
      // Per-scenario receipt is emitted by the test process, *not* this verifier.
      // Test stdout must include one machine-readable proof from executed code.
      const matches=(child.stdout||'').split(/\r?\n/).map(l=>l.match(/@@MEMORY_K_W09_RECEIPT@@(\{.*\})/)).filter(Boolean);
      let proof=null;
      try{if(matches.length===1)proof=JSON.parse(matches[0][1]);}catch{}
      const verified=child.status===0 && matches.length===1&&
        proof?.scenarioId===id&&proof?.headSha===headSha&&
        proof?.phase==='original_runner_integrated_source_simulation'&&
        proof?.result==='pass'&&Number.isSafeInteger(proof.runnerInvocations)&&
        proof.runnerInvocations>0&&Number.isSafeInteger(proof.durableSqliteReadbacks)&&
        proof.durableSqliteReadbacks>0&&
        typeof proof.originalRunnerSourceSha256==='string'&&
        proof.originalRunnerSourceSha256===result.sourceHashes['lsa-essential-e1-candidate/src/openai/runSequentialTurn.mjs']&&
        typeof proof.p2SourceSha256==='string'&&
        proof.p2SourceSha256===result.sourceHashes['lsa-shared-brain/src/characters/sqliteProfileStore.mjs'];
      result.scenarios[id]={
        status:verified?'pass':'blocked',phase:'original_runner_integrated_source_simulation',
        sourceFile:scenarioFile,exitCode:child.status??-1,
        stdoutSha256:hash(child.stdout||''),stderrSha256:hash(child.stderr||''),
        receipt:verified?proof:null,stderrTail:(child.stderr||'').slice(-4000)
      };
      if(!verified)result.failures.push(id+': executed source receipt absent, nonmatching or failing');
    }
    gate('A10-original-M0',ids.every(id=>result.scenarios[id]?.status==='pass'),
      'all ten cases must execute original-runner+P2 source tests with exact final SHA receipts');
    gate('A09-pinned-package-and-native',existsSync(path.join(root,
      'artifacts/memory-k/w09-pinned-package-receipt.json')) &&
      (()=>{try{const receipt=JSON.parse(fileText(
        'artifacts/memory-k/w09-pinned-package-receipt.json'));return
          receipt.headSha===headSha&&receipt.status==='pass'}catch{return false}})(),
      'separate pinned AST/build/package/native-compiled verification must pass on same SHA');
  }
} catch(error){
  result.failures.push('harness_exception: '+String(error?.stack||error));
} finally {
  flush();
}
process.exitCode=result.failures.length?1:0;
