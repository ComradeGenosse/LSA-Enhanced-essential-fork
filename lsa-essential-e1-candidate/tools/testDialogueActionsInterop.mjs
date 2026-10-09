import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ActivityRuntime} from '../src/activities/activityRuntime.mjs';
import {projectDialogueActionKnowledge} from '../src/activities/dialogueActionKnowledge.mjs';
// Real Windows pipe and production session/correlator; callbacks are synthetic.
export async function testDialogueActionsInterop({helperPath=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../native/activities/tests/bin/Debug/net481/ActivityTests.exe')}={}){
 if(process.platform!=='win32')throw Error('Windows dialogue receipt pipe test requires Windows.');
 const pipeName='LSA.C05.Interop.'+randomUUID().replaceAll('-','');
 const helper=spawn(helperPath,['--serve-dialogue',pipeName],{windowsHide:true,stdio:['ignore','ignore','pipe']});
 let failure=null,errorBytes=0,debug="";helper.on('error',error=>failure=error);helper.on('exit',code=>{if(code!==null)failure=Error('Receipt helper exited.');});
 helper.stderr.on('data',chunk=>{errorBytes+=chunk.length;debug+=chunk.toString();if(errorBytes>4096){failure=Error('Helper error output limit');helper.kill();}});
 let runtime=new ActivityRuntime({mode:'shadow',pipeName,dialogueReceipts:true});
 const wait=async predicate=>{const deadline=Date.now()+8000;while(!predicate() && !failure && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));if(failure)throw failure;if(!predicate())throw Error('Dialogue receipt transport timed out. '+debug+' ready='+runtime.client.runtime.ready+' pending='+runtime.dialogueReceipts.pendingCount);};
 let passed=0;
 const check=(value,message)=>{if(!value)throw Error(message);passed++;};
 try{
  runtime.start();await wait(()=>runtime.client.runtime.ready);check(runtime.client.runtime.dialogueActionVersion===1,'C05 negotiation missing.');
  const hostContext=runtime.client.runtime.hostContext,ordinary={captureRef:randomUUID(),hostContext};
  for(const owned of [false,true])for(const canonicalAction of ['waithere','sitonground']){
   const binding=owned?{captureRef:randomUUID(),hostContext,encounterId:randomUUID(),incarnationId:randomUUID()}:ordinary;
   const row=runtime.recordDialogueActionPublication({tuple:{pedId:'17',turnId:randomUUID(),generationId:1,sessionNonce:1},binding,canonicalAction,publishedAtMs:Date.now(),allowedActions:[canonicalAction]});
   check(!!row && !row.state,'Publication was not sent.');await wait(()=>runtime.readDialogueActionReceipts(binding).some(receipt=>receipt.publicationId===row.publicationId));
   const receipt=runtime.readDialogueActionReceipts(binding).find(receipt=>receipt.publicationId===row.publicationId);
   check(receipt.state===(canonicalAction==='waithere'?'HANDLER_ACCEPTED':'FAILED'),'Native handler result changed across pipe.');
   check(receipt.atGameTick===102 && receipt.tuple.turnId===row.tuple.turnId && receipt.publishedAtMs===row.publishedAtMs,'Original receipt association changed.');
   const facts=projectDialogueActionKnowledge({binding,receipts:[receipt]}).facts;
   check(facts.length===1 && !JSON.stringify(facts).includes(row.publicationId),'Receipt SELF projection missing or private.');
  }
  const sequence=runtime.client.outSequence;
  check(runtime.recordDialogueActionPublication({binding:{...ordinary,hostContext:{...hostContext,worldEpoch:2}},tuple:{pedId:'17',turnId:'stale',generationId:1,sessionNonce:1},canonicalAction:'waithere',publishedAtMs:Date.now(),allowedActions:['waithere']})===null,'Stale host publication was admitted.');
  check(runtime.client.outSequence===sequence,'Rejected publication consumed sequence.');
  await wait(()=>runtime.client.runtime.counters.activities!==undefined);check(runtime.client.runtime.counters.activities===0,'Passive receipts started an activity.');
  check(runtime.readDialogueActionReceipts(ordinary).length===2,'Ordinary receipts were not retained.');
  runtime.stop();check(runtime.dialogueReceipts.read(ordinary).length===0,'Stop retained old receipts.');
  runtime=new ActivityRuntime({mode:'shadow',pipeName,dialogueReceipts:true});runtime.start();await wait(()=>runtime.client.runtime.ready);
  check(runtime.readDialogueActionReceipts(ordinary).length===0,'Reconnect resurrected receipt evidence.');
  const fresh=runtime.recordDialogueActionPublication({tuple:{pedId:'17',turnId:'fresh',generationId:2,sessionNonce:2},binding:ordinary,canonicalAction:'waithere',publishedAtMs:Date.now(),allowedActions:['waithere']});
  await wait(()=>runtime.readDialogueActionReceipts(ordinary).some(row=>row.publicationId===fresh?.publicationId));check(runtime.readDialogueActionReceipts(ordinary)[0].tuple.sessionNonce===2,'Fresh connection used old tuple.');
  const peerFaults=['mixed_host','stale_world','sequence_gap','malformed_action','half_owned'];
  for(const fault of peerFaults){
   // Bypass the Node sender validator only in this adversarial peer fixture.
   // The native session must independently reject this exact wire packet.
   const packet={version:1,type:'dialogue.action.pending',dialogueActionVersion:1,sequence:++runtime.client.outSequence,publicationId:randomUUID(),tuple:{pedId:'17',turnId:'invalid-peer',generationId:3,sessionNonce:3},binding:{...ordinary},canonicalAction:'waithere',publishedAtMs:Date.now()};
   if(fault==='mixed_host')packet.binding.hostContext={...hostContext,hostRunId:randomUUID()};
   if(fault==='stale_world')packet.binding.hostContext={...hostContext,worldEpoch:2};
   if(fault==='sequence_gap')packet.sequence++;
   if(fault==='malformed_action')packet.canonicalAction='waithere\n';
   if(fault==='half_owned')packet.binding.encounterId=randomUUID();
   const stranded=runtime.dialogueReceipts.publish({tuple:{pedId:'17',turnId:'unsent',generationId:5,sessionNonce:5},binding:ordinary,canonicalAction:'followtarget',publishedAtMs:Date.now(),allowedActions:['followtarget']});
   check(!!stranded && runtime.dialogueReceipts.pendingCount===1,'Peer fixture did not create pending evidence: '+fault);
   runtime.client.deliver(packet);await wait(()=>!runtime.client.runtime.ready);
   check(runtime.dialogueReceipts.read(ordinary).length===0,'Native peer rejection retained old receipts: '+fault);
   check(runtime.dialogueReceipts.pendingCount===0,'Native peer rejection retained pending publications: '+fault);
   runtime.stop();runtime=new ActivityRuntime({mode:'shadow',pipeName,dialogueReceipts:true});runtime.start();await wait(()=>runtime.client.runtime.ready);
   check(runtime.readDialogueActionReceipts(ordinary).length===0,'Rejected connection evidence reappeared: '+fault);
   const successor=runtime.recordDialogueActionPublication({tuple:{pedId:'17',turnId:'after-'+fault,generationId:4,sessionNonce:4},binding:ordinary,canonicalAction:'waithere',publishedAtMs:Date.now(),allowedActions:['waithere']});
   await wait(()=>runtime.readDialogueActionReceipts(ordinary).some(row=>row.publicationId===successor?.publicationId));
   check(runtime.readDialogueActionReceipts(ordinary)[0].tuple.turnId==='after-'+fault,'Peer rejection contaminated fresh publication: '+fault);
  }
  return {passed,transport:'windows_current_user_activity_pipe',ordinary:true,owned:true,peerRejections:peerFaults.length,callbackEvidence:'synthetic_before_and_handler',gameAssembliesExecuted:false,dispatched:false,physicalAcceptance:false};
 }finally{runtime.stop();helper.kill();}
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await testDialogueActionsInterop({helperPath:process.argv[2]})));
