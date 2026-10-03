import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IntelligenceClient } from '../src/perception/intelligenceClient.mjs';

// Real Windows transport, real production .NET channel and Node client. The
// helper links production sources with no RAGE/Essential assembly references.
export async function testPerceptionInterop({helperPath=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../native/intelligence/tests/bin/Debug/net481/IntelligenceTests.exe')}={}) {
  if(process.platform!=='win32') throw new Error('Windows factual pipe test requires Windows.');
  const pipeName='LSA.PS.Interop.'+randomUUID().replaceAll('-','');
  const helper=spawn(helperPath,['--serve',pipeName],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let failure=null;helper.on('error',e=>{failure=e;});
  let errorBytes=0;helper.stderr.on('data',chunk=>{errorBytes+=chunk.length;if(errorBytes>4096) {failure=new Error('Helper error output limit');helper.kill();}});
  const client=new IntelligenceClient({mode:'shadow',pipeName},{report:()=>{}});
  try {
    client.start();const deadline=Date.now()+5000;
    while(Date.now()<deadline && client.runtime.counters.received===0 && !failure) await new Promise(resolve=>setTimeout(resolve,25));
    if(failure || client.runtime.counters.received!==1 || client.runtime.anchors.size!==1 || client.runtime.signals[0]?.value.kind!=='firing') throw new Error('Production .NET/Node factual transport failed.');
    return {passed:1,transport:'windows_current_user_factual_pipe',gameAssembliesExecuted:false};
  } finally {client.stop();helper.kill();}
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) console.log(JSON.stringify(await testPerceptionInterop({helperPath:process.argv[2]})));
