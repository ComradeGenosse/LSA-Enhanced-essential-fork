import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ActivityClient } from '../src/activities/activityClient.mjs';

export async function testActivitiesInterop({ helperPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../native/activities/tests/bin/Debug/net481/ActivityTests.exe') } = {}) {
  if (process.platform !== 'win32') throw new Error('Windows activity pipe test requires Windows.');
  const pipeName = 'LSA.ACT.Interop.' + randomUUID().replaceAll('-', '');
  const helper = spawn(helperPath, ['--serve', pipeName], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let failure = null; helper.on('error', error => { failure = error; });
  let errorBytes = 0; helper.stderr.on('data', chunk => { errorBytes += chunk.length; if (errorBytes > 4096) { failure = new Error('Helper error output limit'); helper.kill(); } });
  const client = new ActivityClient({ mode: 'shadow', pipeName }, { onEvent: () => {} });
  try {
    client.start(); const deadline = Date.now() + 8000;
    while (Date.now() < deadline && !client.runtime.ready && !failure) await new Promise(resolve => setTimeout(resolve, 25));
    if (failure || !client.runtime.ready) throw new Error('Production .NET/Node activity transport failed.');
    const leaseDeadline = Date.now() + 3000;
    while (Date.now() < leaseDeadline && client.runtime.counters.activities === undefined && !failure) await new Promise(resolve => setTimeout(resolve, 25));
    if (client.runtime.counters.activities === undefined) throw new Error('Activity diagnostics were not delivered.');
    return { passed: 1, transport: 'windows_current_user_activity_pipe', gameAssembliesExecuted: false, dispatched: false };
  } finally { client.stop(); helper.kill(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await testActivitiesInterop({ helperPath: process.argv[2] })));
