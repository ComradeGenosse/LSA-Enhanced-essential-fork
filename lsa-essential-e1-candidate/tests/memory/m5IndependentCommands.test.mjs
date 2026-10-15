// I1: independently enabled M5 explicit memory commands in the REAL foreground
// pipeline. Everything here uses the existing offline D01 harness: the pinned
// original OpenAI turn runner, D01/D02/D03 accepted line, durable P2 SQLite and
// the single PS4 frame. Only GTA/native and OpenAI HTTP are scripted. Nothing in
// this file is a GTA receipt.
import test from 'node:test';
import assert from 'node:assert/strict';
import {d01Harness} from './d01-harness.mjs';
import {decide} from '../../src/openai/decide.mjs';
import {createEssentialMemoryStorage} from '../../src/characters/memoryStorageAdapter.mjs';
import {prepareM5Commands} from '../../src/memory/m5IndependentCommands.mjs';
import {worldProfileId} from '../identity-fixtures.mjs';
import {normalizeMemoryKConfig} from '../../src/memory/capabilityPolicy.mjs';

const off=Object.freeze({
  'memory.dialogue.player':'on','memory.dialogue.npc':'on',
  'memory.journalContext':'off','memory.recall':'off','memory.commands':'on',
  'memory.interpretation':'off','memory.events':'off','memory.coverage':'off'
});
const configured=(edits={})=>({memoryK:{capabilities:{...off,...edits}}});
const response=(dialogue='Got it.')=>new Response(JSON.stringify({status:'completed',output:[{
  type:'message',content:[{type:'output_text',text:JSON.stringify({dialogue,command:''})}]
}]}),{headers:{'content-type':'application/json'}});
function capture(x,fetchImpl){
  const sent=[];
  x.h.runtime.services.decide=options=>decide({...options,config:x.h.runtime.config,
    fetchImpl:async(url,req)=>{
      sent.push({body:req.body,frame:options.knowledgeProjection,options});
      return fetchImpl?fetchImpl(url,req,sent.length):response();
    }});
  return sent;
}
async function say(x,text){
  const turn=await x.typed(text),result=await x.settled(turn);
  // On a Windows-only source-fence failure, print *closed-set* runtime state
  // instead of treating a model_error as proof that M5 itself failed.
  assert.equal(result.status,'completed',JSON.stringify({
    result,command:x.h.runtime.services.memoryCommandDiagnostics(),
    ownerState:x.d02.port.status()?.settled,
    sourceFenceAvailable:x.store.memoryReadFence!==null
  }));
  return result;
}
// A real original-mic STT turn (the only source a transcript correction may target).
async function speak(x,text){
  x.h.runtime.services.transcribe=async()=>text;
  const turn=await x.mic(),result=await x.settled(turn);
  assert.equal(result.status,'completed',JSON.stringify(result));
}
const distinctReplies=(x)=>capture(x,async(_u,_r,n)=>response('Reply number '+n+'.'));
const lanes=entry=>JSON.parse(entry.frame.modelAllocation.scene).lanes;
const scopeOf=(x,protagonistKey=x.native.avatar)=>({characterId:x.profile.characterId,
  worldProfileId:x.store.worldProfileId,timelineId:x.timelineId,protagonistKey});
const permanent=(x,protagonistKey='franklin')=>
  x.store.readPermanentMemoryRows(scopeOf(x,protagonistKey),{limit:50});
const commandRows=x=>x.store.withP2SqliteRead(
  {characterId:x.profile.characterId,worldProfileId:x.store.worldProfileId,timelineId:x.timelineId},db=>
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_commands'").get()
      ?db.prepare('SELECT operation,command_id FROM memory_commands').all():[]);
const suppressed=x=>x.store.listSuppressedMemoryIds(scopeOf(x));
const overlays=x=>x.store.readCorrectionOverlays(scopeOf(x));
const diag=x=>x.h.runtime.services.memoryCommandDiagnostics();

test('1. M5-only: commands work with H1, H2 and M8 all disabled; remember is one verified durable memory',
  {timeout:45000},async t=>{
    const x=await d01Harness(t,{config:configured()});
    x.store.readIntegratedRecall=()=>{throw Error('M5-only must never call M4 recall');};
    const sent=capture(x);
    await say(x,'Remember that I prefer black coffee.');
    const last=sent.at(-1),l=lanes(last);
    assert.deepEqual(l.SELF.memoryAction,[{outcome:'saved',durableCommit:true}]);
    assert.equal(l.RECALLED.evidence,undefined,'H2 stays off');
    assert.equal(l.RECALLED.characterOpinions,undefined,'M8 stays off');
    assert.equal(last.frame.modelAllocation.messages.length,1,'H1 stays off');
    assert.equal(x.h.runtime.memoryM3,undefined);
    const rows=await permanent(x);
    assert.equal(rows.filter(r=>JSON.stringify(r).includes('I prefer black coffee')).length,1,
      'exactly one durable memory');
    assert.equal((await commandRows(x)).length,1,'exactly one durable command receipt');
    assert.equal(x.h.runtime.services.memoryJournalDiagnostics().state,'stopped');
    assert.equal(x.h.runtime.services.memoryRecallDiagnostics().state,'stopped');
    const d=diag(x);
    assert.equal(d.state,'ready');assert.equal(d.code,'durable_command_success');
    assert.equal(d.contributedToModelRequest,true);
    assert.equal(d.lastValidation.status,'ready');
    // The diagnostic carries no player text, memory content or identifiers.
    assert.ok(!JSON.stringify(d).includes('coffee'));
  });

test('2. duplicate delivery of the same accepted line replays one command, never a second memory',
  {timeout:45000},async t=>{
    const x=await d01Harness(t,{config:configured()});
    const original=x.h.runtime.services.prepareLiveTurnMemory;
    const results=[];
    // The same accepted line delivered three times within its own turn.
    x.h.runtime.services.prepareLiveTurnMemory=async a=>{
      for(let i=0;i<3;i++)results.push(await original(a));
      return results.at(-1);
    };
    capture(x);
    await say(x,'Remember that I prefer black coffee.');
    assert.equal(results.length,3);
    for(const r of results)assert.deepEqual(r?.memoryAction,[{outcome:'saved',durableCommit:true}],
      'a replay is verified against the existing receipt');
    const rows=await permanent(x);
    assert.equal(rows.filter(r=>JSON.stringify(r).includes('I prefer black coffee')).length,1);
    assert.equal((await commandRows(x)).length,1);
  });

test('3. forget suppresses the targeted memory and survives a store restart',
  {timeout:45000},async t=>{
    const x=await d01Harness(t,{config:configured()});
    const sent=distinctReplies(x);
    await say(x,'I told you about my old job at the lumber yard.');
    const target=(await x.journal()).players[0].record_id;
    await say(x,'Forget that I told you about my old job.');
    assert.deepEqual(lanes(sent.at(-1)).SELF.memoryAction,[{outcome:'forgotten',durableCommit:true}]);
    assert.deepEqual(await suppressed(x),[target]);
    // Restart: reopen the same SQLite file in a brand-new store instance.
    const filePath=x.store.filePath;
    await x.store.close();
    const reopened=createEssentialMemoryStorage({filePath,worldProfileId,sourceRequired:true});
    // Close the second SQLite connection *before* d01Harness removes its
    // temporary directory. Registering another t.after hook here left the
    // reopened database live during Windows file deletion (EBUSY).
    try {
      await reopened.initialize();
      const ids=await reopened.listSuppressedMemoryIds(scopeOf(x));
      assert.deepEqual(ids,[target],'tombstone survives restart');
    } finally {
      await reopened.close();
    }
  });

test('4. correction supersedes the mis-transcribed referent; the superseded text is not model-visible',
  {timeout:45000},async t=>{
    const x=await d01Harness(t,{config:configured()});
    const sent=distinctReplies(x);
    // M5 transcript corrections target a real STT (mic) line, as in GTA.
    await speak(x,'My favorite color is blue.');
    const target=(await x.journal()).players[0].record_id;
    await say(x,'No, I said my favorite color is green.');
    assert.deepEqual(lanes(sent.at(-1)).SELF.memoryAction,[{outcome:'corrected',durableCommit:true}]);
    const found=(await overlays(x)).filter(o=>o.targetId===target);
    assert.equal(found.length,1,'one durable correction overlay for the referent');
    assert.equal(found[0].supersedesTarget!==false,true);
    assert.ok(!sent.at(-1).body.includes('favorite color is blue'));
    assert.equal((await commandRows(x)).length,1);
  });

test('5. ambiguous commands use durable clarification and never guess',
  {timeout:45000},async t=>{
    const x=await d01Harness(t,{config:configured()});
    const sent=distinctReplies(x);
    await say(x,'I like the red truck.');
    await say(x,'I like the blue boat.');
    await say(x,'Forget that');
    assert.deepEqual(lanes(sent.at(-1)).SELF.memoryAction,[{outcome:'clarify',durableCommit:false}]);
    assert.deepEqual(await suppressed(x),[],'clarification performs no destructive write');
    assert.equal(diag(x).code,'clarification_required');
    await say(x,'the first one');
    const action=lanes(sent.at(-1)).SELF.memoryAction;
    assert.deepEqual(action,[{outcome:'forgotten',durableCommit:true}]);
    const ids=new Set((await x.journal()).rows.map(r=>r.record_id));
    const gone=await suppressed(x);
    assert.equal(gone.length,1,'exactly the chosen candidate is suppressed');
    assert.ok(ids.has(gone[0]));
    assert.equal(diag(x).code,'durable_command_success');
  });

test('6. M5 alongside H1 and H2 never leaks superseded or forgotten text in the same or later turns',
  {timeout:60000},async t=>{
    const x=await d01Harness(t,{config:configured({'memory.journalContext':'on','memory.recall':'on'})});
    const sent=distinctReplies(x);
    await speak(x,'My favorite color is blue.');
    await say(x,'I told you about my old job at the lumber yard.');
    await say(x,'No, I said my favorite color is green.');
    assert.deepEqual(lanes(sent.at(-1)).SELF.memoryAction,[{outcome:'corrected',durableCommit:true}]);
    assert.ok(!sent.at(-1).body.includes('favorite color is blue'),
      'H1/H2 were prepared from the post-command durable state of the SAME turn');
    await say(x,'Forget that I told you about my old job.');
    assert.deepEqual(lanes(sent.at(-1)).SELF.memoryAction,[{outcome:'forgotten',durableCommit:true}]);
    assert.ok(!sent.at(-1).body.includes('lumber yard'));
    await say(x,'What do you know about me?');
    const body=sent.at(-1).body;
    assert.ok(!body.includes('favorite color is blue'));
    assert.ok(!body.includes('lumber yard'));
    assert.ok(body.includes('favorite color is green'),
      'the correction itself stays recallable and passes H2 source verification');
    assert.equal(x.h.runtime.services.memoryJournalDiagnostics().lastValidation.status,'ready');
  });

test('7. memory.commands off performs no optional command write and asserts no success',
  {timeout:45000},async t=>{
    for(const withH1 of [false,true]){
      await t.test('h1='+withH1,async t2=>{
        const x=await d01Harness(t2,{config:configured({
          'memory.commands':'off','memory.journalContext':withH1?'on':'off'})});
        const sent=capture(x);
        await say(x,'Remember that I prefer black coffee.');
        await say(x,'Forget that I told you about my old job.');
        assert.equal(lanes(sent.at(-1)).SELF.memoryAction,undefined);
        assert.equal((await permanent(x)).length,0);
        assert.equal((await commandRows(x)).length,0);
        assert.deepEqual(await suppressed(x),[]);
        const d=diag(x);
        assert.equal(d.state,'stopped');assert.equal(d.code,'disabled_by_configuration');
        assert.equal(d.contributedToModelRequest,false);
      });
    }
  });

test('8. ordinary conversation, casual "remember when" and inspector requests never write or speak archive contents',
  {timeout:60000},async t=>{
    const x=await d01Harness(t,{config:configured()});
    const sent=capture(x);
    await say(x,'Remember that I prefer black coffee.');
    let reads=0;const original=x.store.readDialogueLines.bind(x.store);
    x.store.readDialogueLines=async(...a)=>{reads++;return original(...a);};
    const before=(await commandRows(x)).length,memories=(await permanent(x)).length;
    for(const line of ['The weather is lovely today.','Remember when we robbed the bank?',
        'I remember that day fondly.']){
      await say(x,line);
      assert.equal(lanes(sent.at(-1)).SELF.memoryAction,undefined,line);
    }
    assert.equal(reads,0,'ordinary text never opens the M5 source or reads SQLite history');
    assert.equal(diag(x).code,'command_not_recognized');
    for(const line of ['Export my memories.','Do you remember what I said about coffee?']){
      await say(x,line);
      assert.equal(lanes(sent.at(-1)).SELF.memoryAction,undefined,line);
      assert.ok(!sent.at(-1).body.includes('black coffee'),
        'inspector-only requests never expose confidential contents through speech');
    }
    assert.equal(diag(x).code,'private_editor_required');
    assert.equal((await commandRows(x)).length,before);
    assert.equal((await permanent(x)).length,memories);
  });

test('9. a reassuring model reply never creates success; failed or unverified commits report failure',
  {timeout:60000},async t=>{
    const x=await d01Harness(t,{config:configured()});
    const sent=capture(x,async()=>response('Done, I will remember that forever.'));
    await say(x,'The sky is green today.');
    assert.equal(lanes(sent.at(-1)).SELF.memoryAction,undefined);
    assert.equal((await permanent(x)).length,0,'dialogue never writes memory');
    // Commit throws: the model is told the change failed.
    const commit=x.store.commitCommand.bind(x.store);
    x.store.commitCommand=async()=>{throw Error('disk full');};
    await say(x,'Remember that I prefer black coffee.');
    assert.deepEqual(lanes(sent.at(-1)).SELF.memoryAction,[{outcome:'failed',durableCommit:false}]);
    assert.equal(diag(x).code,'command_failure');
    x.store.commitCommand=commit;
    // Commit succeeds but durable readback is unavailable: still not a success.
    const verify=x.store.verifyCommand.bind(x.store);
    x.store.verifyCommand=async()=>null;
    await say(x,'Remember that I like jazz.');
    assert.deepEqual(lanes(sent.at(-1)).SELF.memoryAction,[{outcome:'failed',durableCommit:false}]);
    x.store.verifyCommand=verify;
    assert.ok(!JSON.stringify(sent.at(-1).frame.modelAllocation).includes('"saved"'));
  });

test('10. retry keeps the one verified request; a revoked source never reaches HTTP',
  {timeout:60000},async t=>{
    await t.test('retry',async t2=>{
      const x=await d01Harness(t2,{config:configured()});
      const bodies=[];
      x.h.runtime.services.decide=options=>decide({...options,config:x.h.runtime.config,
        fetchImpl:async(_u,req)=>{
          bodies.push(req.body);
          return bodies.length===1?new Response('{}',{status:503,headers:{'content-type':'application/json'}}):response();
        }});
      await say(x,'Remember that I prefer black coffee.');
      assert.equal(bodies.length,2);assert.equal(bodies[0],bodies[1]);
      assert.equal((await commandRows(x)).length,1,'a provider retry never repeats the command');
      assert.equal((await permanent(x)).filter(r=>JSON.stringify(r).includes('black coffee')).length,1);
    });
    for(const boundary of ['native_owner','timeline','host']){
      await t.test('revoked '+boundary,async t2=>{
        const x=await d01Harness(t2,{config:configured()});
        let requests=0;
        x.h.runtime.services.decide=options=>decide({...options,config:x.h.runtime.config,
          dialogueAttempt:{request:()=>{
            if(boundary==='native_owner'){x.native.stop();x.client.stop();}
            if(boundary==='timeline')x.store.onBoundary({reason:'timeline_change'});
            if(boundary==='host')x.store.setVerifiedHostContext(null);
          },outputText:()=>{}},
          fetchImpl:async()=>{requests++;return response();}});
        const turn=await x.typed('Remember that I prefer black coffee.');
        assert.notEqual((await x.settled(turn)).status,'completed');
        assert.equal(requests,0,'a retired source cannot send a command acknowledgement');
        const d=diag(x);
        assert.equal(d.state,'blocked');assert.equal(d.lastValidation?.status,'invalidated');
        assert.equal(d.contributedToModelRequest,false);
      });
    }
    await t.test('stale/retired owner cannot start a command',async t2=>{
      const x=await d01Harness(t2,{config:configured()});
      capture(x);
      const original=x.h.runtime.services.prepareLiveTurnMemory;
      x.h.runtime.services.prepareLiveTurnMemory=async a=>{
        x.store.onBoundary({reason:'timeline_change'});   // owner/timeline retired first
        return original(a);
      };
      const turn=await x.typed('Remember that I prefer black coffee.');
      await x.settled(turn);
      await x.store.confirmTimeline(x.timelineId);   // re-enable reads to inspect
      assert.equal((await permanent(x)).length,0);
      assert.equal((await commandRows(x)).length,0);
    });
  });

test('11. each GTA avatar is attributed correctly and a foreign NPC scope cannot be written',
  {timeout:60000},async t=>{
    const x=await d01Harness(t,{config:configured()});
    const sent=capture(x);
    await say(x,'Remember that I prefer black coffee.');
    x.native.avatar='michael';await x.native.sample();
    await say(x,'Remember that I like jazz.');
    assert.deepEqual(lanes(sent.at(-1)).SELF.memoryAction,[{outcome:'saved',durableCommit:true}]);
    // One persistent human across avatars (D-021): both memories belong to the
    // NPC, each attributed to the avatar that actually spoke the command.
    const rows=await permanent(x);
    const owner=text=>rows.find(r=>JSON.stringify(r).includes(text))?.protagonistKey;
    assert.equal(owner('black coffee'),'franklin');
    assert.equal(owner('jazz'),'michael');
    // A turn bound to a different promoted character cannot modify this NPC.
    let args=null;const original=x.h.runtime.services.prepareLiveTurnMemory;
    x.h.runtime.services.prepareLiveTurnMemory=async a=>{args=a;return original(a);};
    await say(x,'Remember that I like tea.');
    const before=(await commandRows(x)).length;
    assert.equal(before,3);
    const foreign=structuredClone(args.turn.characterProjection.profile);
    foreign.characterId='99999999-9999-4999-8999-999999999999';
    const result=await prepareM5Commands({store:x.store,...args,
      turn:{...args.turn,characterProjection:{...args.turn.characterProjection,profile:foreign}}});
    assert.notEqual(result.status,'ready');
    assert.equal((await commandRows(x)).length,before);
  });

test('12. a missing durable accepted receipt blocks commands without reviving anything',
  {timeout:45000},async t=>{
    const x=await d01Harness(t,{config:configured()});
    const sent=capture(x);
    x.h.runtime.services.recordM2Player=async()=>null;
    await say(x,'Remember that I prefer black coffee.');
    assert.equal(lanes(sent.at(-1)).SELF.memoryAction,undefined);
    assert.equal((await permanent(x)).length,0);
    const d=diag(x);
    assert.equal(d.lastPreparation.reason,'accepted_line_authority_missing');
    assert.equal(d.contributedToModelRequest,false);
  });

test('13. shadow is rejected at configuration; M5 without the player-dialogue prerequisite is blocked, not hidden',
  {timeout:45000},async t=>{
    assert.throws(()=>normalizeMemoryKConfig({capabilities:{'memory.commands':'shadow'}}),
      /memory\.commands mode is unsupported/);
    const noPlayer=await d01Harness(t,{config:configured({'memory.dialogue.player':'off','memory.dialogue.npc':'off'})});
    const d=diag(noPlayer);
    assert.equal(d.state,'blocked');
    assert.equal(d.reason,'dependency_not_requested_or_available:memory.dialogue.player');
    assert.equal(d.code,'missing_dependency');
    await say(noPlayer,'Remember that I prefer black coffee.');
    assert.equal((await permanent(noPlayer)).length,0);
  });

test('14. documented limitation: a leading "Actually," is not recognised by the existing M5 parser and stays ordinary dialogue',
  {timeout:45000},async t=>{
    const x=await d01Harness(t,{config:configured()});
    const sent=capture(x);
    await say(x,'My favorite color is blue.');
    await say(x,'Actually, I meant that my favorite color is green.');
    assert.equal(lanes(sent.at(-1)).SELF.memoryAction,undefined);
    assert.equal((await commandRows(x)).length,0);
    assert.equal(diag(x).code,'command_not_recognized');
  });
