// D04 red-team fixture: perfectly shaped self-reported W09 receipts without
// executing ORIGINAL runner, using real P2 or writing any SQLite MUST NOT pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {measureScenarioEvidence} from '../replay-evidence-verifier.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const sha=file=>createHash('sha256').update(readFileSync(path.join(root,file))).digest('hex');
test('forged stdout receipt with fake original runner/P2 counts is rejected externally',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'w09-forgery-negative-'));
  try{
    const child=spawnSync(process.execPath,['-e',
      'console.log("@@MEMORY_K_W09_RECEIPT@@"+JSON.stringify('+JSON.stringify({
        scenarioId:'S01',headSha:'a'.repeat(40),
        phase:'original_runner_integrated_source_simulation',result:'pass',
        runnerInvocations:999,durableSqliteReadbacks:500,
        originalRunnerSourceSha256:sha('lsa-essential-e1-candidate/src/openai/runSequentialTurn.mjs'),
        p2SourceSha256:sha('lsa-shared-brain/src/characters/sqliteProfileStore.mjs')
      })+'))'],{cwd:root,encoding:'utf8',
        env:{...process.env,NODE_V8_COVERAGE:path.join(dir,'coverage')},
        timeout:20000});
    assert.equal(child.status,0);
    assert.match(child.stdout,/@@MEMORY_K_W09_RECEIPT@@/);
    const observation=measureScenarioEvidence({root,coverageDir:path.join(dir,'coverage'),
      dbPath:path.join(dir,'p2-evidence.sqlite'),childStatus:child.status,
      stdout:child.stdout,scenarioId:'S01'});
    assert.equal(observation.pass,false);
    assert.equal(observation.facts.runner.entryExecuted,false);
    assert.equal(observation.facts.p2.entryExecuted,false);
    assert.equal(observation.facts.sqlite.exists,false);
    assert.ok(observation.missing.includes('D01_D02_ATOMIC_ORIGIN_RECEIPT_UNAVAILABLE'));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
