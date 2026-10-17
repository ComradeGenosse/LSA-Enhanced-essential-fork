import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {validateFrame,validateM9SamplePayload} from '../src/perception/contracts.mjs';

// Cross-language receipt: payloads produced by the REAL native M9StateSampler
// (portable C# harness, not GTA) must satisfy the strict JS m9_sample contract.
// The harness is built by CI (native/intelligence/m9-tests); skipped when absent.
const exe = fileURLToPath(new URL('../../native/intelligence/m9-tests/bin/Debug/net481/M9NativeTests.exe',import.meta.url));

async function frames(t) {
  if (!existsSync(exe)) {t.skip('M9NativeTests.exe not built');return null;}
  const [command,args] = process.platform === 'win32' ? [exe,['--m9-wire']] : ['mono',[exe,'--m9-wire']];
  try {
    const {stdout} = await promisify(execFile)(command,args,{timeout:60000});
    return stdout.split(/\r?\n/).filter(line => line.startsWith('M9_WIRE ')).map(line => JSON.parse(line.slice(8)));
  } catch (error) {
    if (error.code === 'ENOENT') {t.skip('mono unavailable');return null;}
    throw error;
  }
}

test('native M9StateSampler payloads satisfy the strict m9_sample contract',async t => {
  const payloads = await frames(t);
  if (!payloads) return;
  assert.ok(payloads.length >= 4,'collision, wasted, busted and wanted samples were emitted');
  for (const payload of payloads) {
    assert.equal(validateM9SamplePayload(payload),true,JSON.stringify(payload).slice(0,200));
    const frame = {version:1,type:'m9_sample',adapterEpoch:randomUUID(),streamId:randomUUID(),sequence:1,payload};
    assert.equal(validateFrame(frame),true);
  }
  const kinds = payloads.map(p => p.outcome?.kind ?? (p.vehicle?.collision ? 'crash' : p.wantedLevel > 0 ? 'wanted' : 'other')).sort();
  assert.deepEqual(kinds,['busted','crash','other','wanted','wasted']);
  const heartbeat=payloads.find(p => p.vehicleCaptureRef===null && p.vehicle===null &&
    p.outcome===null && p.wantedLevel===0);
  assert.ok(heartbeat,'verified idle-on-foot heartbeat has no manufactured event');
  assert.deepEqual(heartbeat.witnessReceipts,[],'quiet heartbeat never spends LOS');
  for (const payload of payloads) for (const receipt of payload.witnessReceipts) {
    assert.equal(receipt.status,'witnessed');
    assert.equal(receipt.sampledGameTick,payload.sampledGameTick,'witness is bound to the sample tick');
  }
});

test('a mutated native payload is rejected (negative control)',async t => {
  const payloads = await frames(t);
  if (!payloads) return;
  const crash = payloads.find(p => p.vehicle?.collision);
  assert.equal(validateM9SamplePayload({...crash,extra:true}),false);
  assert.equal(validateM9SamplePayload({...crash,witnessReceipts:crash.witnessReceipts.map(w => ({...w,sampledGameTick:w.sampledGameTick + 1}))}),false);
  assert.equal(validateM9SamplePayload({...crash,vehicleCaptureRef:null}),false);
});
