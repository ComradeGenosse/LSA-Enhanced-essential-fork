import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {discoverTests,verifyInventory} from '../discovery.mjs';
import {selectProfile} from '../profiles.mjs';
import '../offline.mjs';

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
  const inventory=JSON.parse(await readFile(new URL('../inventory.json',import.meta.url),'utf8'));
  verifyInventory(files,inventory.files);
  for(const name of ['policy','storage','source','shared','essential','essential-nested','infrastructure','all'])
    assert.ok(selectProfile(name,files).files.length>0);
  assert.equal(selectProfile('original-scenarios',files).files.length,10);
  assert.ok(selectProfile('all',files).files.some(file=>file.includes('/memory/ws6OriginalRunner')));
});
