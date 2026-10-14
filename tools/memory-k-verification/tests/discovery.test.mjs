import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {discoverTests,verifyInventory,loadInventory} from '../discovery.mjs';
import {selectProfile} from '../profiles.mjs';
import {classifyResults,summaryMarkdown} from '../reporting.mjs';
import '../offline.mjs';

test('reporting separates original NO-GO gates and unexpected source failures without changing outcomes',()=>{
  const gate={file:'tests/memory-k-original-S01.test.mjs',passed:false};
  const source={file:'tests/memory/ws6Latency.test.mjs',passed:false};
  const green={file:'tests/memory-capability-policy.test.mjs',passed:true};
  const results=[gate,source,green],before=JSON.stringify(results);
  const health=classifyResults(results);
  assert.equal(health.scopedVerification.status,'failed');
  assert.deepEqual(health.scopedVerification.failures,[source.file]);
  assert.equal(health.originalReleaseGates.status,'failed');
  assert.deepEqual(health.originalReleaseGates.failures,[gate.file]);
  assert.equal(health.releaseAcceptance,'not_certified');
  assert.equal(JSON.stringify(results),before);
  const scoped=classifyResults([green]);
  assert.equal(scoped.scopedVerification.status,'passed');
  assert.equal(scoped.originalReleaseGates.status,'not_run');
  assert.match(summaryMarkdown({profile:'all',head:'head',exactCleanHead:true,passed:false,health}),/Unresolved verification\/source failure/);
});

test('offline verification denies external provider fetch before any request',async()=>{
  await assert.rejects(fetch('https://api.openai.com/v1/responses'),/External network access is disabled/);
  await assert.rejects(fetch('http://127.0.0.1.example.org/'),/External network access is disabled/);
});

test('recursive discovery includes nested suites, excludes fixtures, is deterministic',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'memory-k-discovery-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'tests/memory'),{recursive:true});
  for(const file of ['z.test.mjs','memory/a.test.mjs','memory/fixture.mjs'])
    await writeFile(path.join(root,'tests',file),'');
  assert.deepEqual(await discoverTests(root,['tests']),['tests/memory/a.test.mjs','tests/z.test.mjs']);
});
test('a removed or unregistered test is a hard discovery failure',()=>{
  assert.throws(()=>verifyInventory(['a'],['a','b']),/missing=\["b"\]/);
  assert.throws(()=>verifyInventory(['a','b'],['a']),/unregistered=\["b"\]/);
  verifyInventory(['a','b'],['b','a']);
});
test('all registered profiles select real tests; original gates remain discoverable',async()=>{
  const root=fileURLToPath(new URL('../../../',import.meta.url));
  const files=await discoverTests(root);
  const inventory=await loadInventory(root);
  verifyInventory(files,inventory.files);
  for(const name of ['policy','storage','source','shared','essential','essential-nested','infrastructure','all'])
    assert.ok(selectProfile(name,files).files.length>0);
  assert.equal(selectProfile('original-scenarios',files).files.length,10);
  assert.ok(selectProfile('all',files).files.some(file=>file.includes('/memory/ws6OriginalRunner')));
});
test('scoped registrations compose with baseline and cannot conceal missing tests',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'memory-k-registration-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const directory=path.join(root,'tools/memory-k-verification');
  await mkdir(path.join(directory,'registrations'),{recursive:true});
  await writeFile(path.join(directory,'inventory.json'),JSON.stringify({version:1,files:['base.test.mjs']}));
  await writeFile(path.join(directory,'registrations/c.json'),JSON.stringify({version:1,files:['c.test.mjs']}));
  assert.deepEqual((await loadInventory(root)).files,['base.test.mjs','c.test.mjs']);
  assert.throws(()=>verifyInventory(['base.test.mjs'],['base.test.mjs','c.test.mjs']),/missing/);
  await writeFile(path.join(directory,'registrations/c.json'),JSON.stringify({version:1,files:['base.test.mjs']}));
  await assert.rejects(loadInventory(root),/Duplicate/);
});
