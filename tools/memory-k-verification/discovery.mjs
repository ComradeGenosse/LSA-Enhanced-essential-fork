import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const suiteRoots = Object.freeze([
  'lsa-essential-e1-candidate/tests', 'lsa-shared-brain/tests',
  'tools/memory-sim/tests', 'tools/memory-k-verification/tests',
]);

export async function discoverTests(root, directories = suiteRoots) {
  const files = [];
  async function visit(relative) {
    for (const entry of await readdir(path.join(root, relative), {withFileTypes:true})) {
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile() && name.endsWith('.test.mjs')) files.push(name);
    }
  }
  for (const directory of directories) await visit(directory);
  return files.sort();
}

export async function fingerprintTests(root, files) {
  return Promise.all(files.map(async file => ({file,
    sha256:createHash('sha256').update(await readFile(path.join(root,file))).digest('hex'),
  })));
}

export function verifyInventory(actual, expected) {
  const missing = expected.filter(file => !actual.includes(file));
  const unregistered = actual.filter(file => !expected.includes(file));
  if (missing.length || unregistered.length) throw new Error(
    `Test inventory changed: missing=${JSON.stringify(missing)} unregistered=${JSON.stringify(unregistered)}. Review and update inventory.json; never silently drop tests.`);
}

// Scoped PRs can register suites without copying or editing the baseline.
// Every registered file remains required; arbitrary new tests still fail.
export async function loadInventory(root) {
  const directory=path.join(root,'tools/memory-k-verification');
  const baseline=JSON.parse(await readFile(path.join(directory,'inventory.json'),'utf8'));
  let registrations=[];
  try { registrations=await readdir(path.join(directory,'registrations')); }
  catch(error) { if(error.code!=='ENOENT') throw error; }
  const files=[...baseline.files];
  for(const name of registrations.filter(name=>name.endsWith('.json')).sort()) {
    const extension=JSON.parse(await readFile(path.join(directory,'registrations',name),'utf8'));
    if(extension.version!==1||!Array.isArray(extension.files)||
      extension.files.some(file=>typeof file!=='string'||!file.endsWith('.test.mjs')))
      throw new Error(`Invalid test registration: ${name}`);
    files.push(...extension.files);
  }
  if(new Set(files).size!==files.length) throw new Error('Duplicate test inventory registration');
  return {version:1,files:files.sort()};
}
