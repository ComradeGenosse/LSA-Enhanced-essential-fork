import {renderKnowledge} from '../src/context/knowledgeRenderer.mjs';
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
    const ps=client.runtime,ref=[...ps.anchors.keys()][0];
    if(ps.hostContext?.hostContextVersion!==1 || ps.observerIndexVersion!==1 || ps.observerSituationVersion!==1 || ps.observerIndex.get(ref)?.kind!=='ped' || ps.situationFor(ref).activity!=='conversation')throw new Error('Production PS4 host/index/situation transport failed.');
    const identity={pedId:'17',turnId:'interop',generationId:1,sessionNonce:1};
    const actor={pedId:'17',integrations:{turnKnowledge:{version:1,hostRunId:ps.hostContext.hostRunId,worldEpoch:ps.hostContext.worldEpoch,captureRef:ref,sampledGameTick:42}}};
    const inputs=client.captureKnowledgeInputs({identity,source:'player_text',p0Snapshot:{identity,revision:1,actor}});
    const frame=renderKnowledge({turn:identity,knowledgeInputs:inputs,actor,input:'What happened?',source:'player_text',includePerceived:true});
    if(inputs.reason || !frame.delivery.length || JSON.stringify(frame.modelAllocation).includes(ref))throw new Error('Production factual transport did not yield bounded PS4 knowledge.');
    return {passed:1,hostContext:true,observerIndex:true,observerSituation:true,knowledgeProjection:true,transport:'windows_current_user_factual_pipe',gameAssembliesExecuted:false};
  } finally {client.stop();helper.kill();}
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) console.log(JSON.stringify(await testPerceptionInterop({helperPath:process.argv[2]})));
