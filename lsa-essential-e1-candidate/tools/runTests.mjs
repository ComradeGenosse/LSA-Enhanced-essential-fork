// Use the same isolated, inventoried source harness as combined verification.
// It includes nested memory tests and supplies original-scenario evidence paths;
// mandatory source-blocked gates retain their failing exit status.
import {spawnSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const output=mkdtempSync(path.join(tmpdir(),'lsa-essential-tests-'));
const result=spawnSync(process.execPath,[path.join(root,'tools/memory-k-verification/run.mjs'),
  '--profile','essential','--output',output],{cwd:root,stdio:'inherit',env:process.env});
console.log('Essential verification evidence: '+output);
if(result.error)throw result.error;
process.exitCode=result.status??1;
