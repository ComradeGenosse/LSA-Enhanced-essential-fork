import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {CAPABILITIES,validateFrame} from '../src/perception/contracts.mjs';
import {ShadowRuntime} from '../src/perception/shadowRuntime.mjs';
import {validateUtteranceFact,UtteranceLifecycle} from '../src/perception/utteranceLifecycle.mjs';

const setup=()=>{
  const hello={version:1,type:'hello',adapterEpoch:randomUUID(),streamId:randomUUID(),
    hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1,utteranceLifecycleVersion:1,
    capabilities:Object.fromEntries(CAPABILITIES.map(k=>[k,false]))};
  let sequence=0,now=1000;
  const runtime=new ShadowRuntime({mode:'shadow',now:()=>now});
  const frame=(type,payload)=>({version:1,type,adapterEpoch:hello.adapterEpoch,
    streamId:hello.streamId,sequence:++sequence,payload});
  const fact=(id,phase,terminal,monotonicMs)=>({utteranceVersion:1,utteranceId:id,phase,terminal,
    hostRunId:hello.hostRunId,worldEpoch:1,gameTick:420,
    monotonicMs,inputSource:'essential_mic',micPedRef:null});
  assert.equal(runtime.ingest(hello,{authenticated:true}),true);
  return {hello,runtime,frame,fact,now:n=>{now=n}};
};

test('C-01 exact source-time frames are opt-in, bounded and never speech knowledge',()=>{
  const {runtime,frame,fact}=setup(),id=randomUUID();
  const start=fact(id,'started',null,100),end=fact(id,'ended','released',180);
  assert.equal(validateUtteranceFact(start),true);
  assert.equal(runtime.ingest(frame('utterance',start),{authenticated:true}),true);
  assert.equal(runtime.utterances.active,id);
  assert.equal(runtime.ingest(frame('utterance',end),{authenticated:true}),true);
  assert.equal(runtime.utterances.active,null);
  assert.equal(runtime.utterances.diagnostics.started,1);
  assert.equal(runtime.utterances.diagnostics.ended,1);
  assert.equal(runtime.observations.entries.size,0);
  assert.equal(runtime.transcripts.entries.size,0);
  assert.equal(runtime.capabilities.playerSpeech,false);
  assert.equal(runtime.ingest(frame('utterance',end),{authenticated:true}),false);
});

test('C-01 fails closed on mismatched run, epoch, duplicate starts, and fabricated text',()=>{
  const {runtime,frame,fact}=setup(),id=randomUUID(),start=fact(id,'started',null,10);
  for(const invalid of [{...start,hostRunId:randomUUID()},{...start,worldEpoch:2}])
    assert.equal(runtime.ingest(frame('utterance',invalid),{authenticated:true}),false);
  for(const invalid of [
    {...start,inputSource:'ux4_ptt'}, {...start,transcript:'private data'},
    {...start,micPedRef:'fake'}, {...start,phase:'ended',terminal:null},
  ]) assert.equal(validateUtteranceFact(invalid),false);
  assert.equal(runtime.ingest(frame('utterance',start),{authenticated:true}),true);
  assert.equal(runtime.ingest(frame('utterance',start),{authenticated:true}),false);
  assert.equal(runtime.ingest(frame('utterance',fact(id,'ended','released',9)),{authenticated:true}),false);
  assert.equal(runtime.utterances.active,id);
});

test('C-01 host changes and legacy hello do not inherit recordings',()=>{
  const {hello,runtime,frame,fact}=setup(),id=randomUUID();
  assert.equal(runtime.ingest(frame('utterance',fact(id,'started',null,10)),{authenticated:true}),true);
  assert.equal(runtime.ingest(frame('world_epoch',{epoch:2,reason:'timeline_change'}),{authenticated:true}),true);
  assert.equal(runtime.utterances.entries.size,0);
  assert.equal(runtime.utterances.active,null);
  assert.equal(runtime.ingest(frame('utterance',fact(id,'ended','released',20)),{authenticated:true}),false);
  const legacy=new ShadowRuntime({mode:'shadow'});
  const {utteranceLifecycleVersion,...unextended}=hello;
  assert.equal(legacy.ingest(unextended,{authenticated:true}),true);
  assert.equal(legacy.ingest({version:1,type:'utterance',adapterEpoch:hello.adapterEpoch,
    streamId:hello.streamId,sequence:1,payload:fact(id,'started',null,10)},{authenticated:true}),false);
  assert.equal(legacy.utterances.entries.size,0);
});

test('C-01 typed player turns carry the exact Essential tuple with zero acoustic observers',()=>{
  const {runtime}=setup();
  const turn={pedId:'abc123',sessionNonce:4,turnId:'turn-7',generationId:2};
  assert.equal(runtime.utterances.recordTyped(turn,runtime.hostContext),true);
  const record=[...runtime.utterances.entries.values()][0];
  assert.equal(record.started.inputSource,'typed');
  assert.equal(record.started.durationMs,0);
  assert.equal(record.started.acousticObservers,0);
  assert.deepEqual(record.started.identity,turn);
  assert.equal(runtime.utterances.diagnostics.typed,1);
  assert.equal(runtime.transcripts.entries.size,0);
  assert.equal(runtime.observations.entries.size,0);
});

test('C-01 ledger applies finite capacity and timeout, never invents missing start',()=>{
  let now=0;const ledger=new UtteranceLifecycle({now:()=>now});
  const host={hostRunId:randomUUID(),worldEpoch:1},id=randomUUID();
  const fact=(phase,terminal,ms)=>({utteranceVersion:1,utteranceId:id,phase,terminal,
    hostRunId:host.hostRunId,worldEpoch:1,gameTick:1,monotonicMs:ms,
    inputSource:'essential_mic',micPedRef:null});
  assert.equal(ledger.accept(fact('ended','released',20),host),false);
  assert.equal(ledger.accept(fact('started',null,10),host),true);
  assert.equal(ledger.accept(fact('ended','released',45),host),true);
  now=31000;
  assert.equal(ledger.accept(fact('ended','released',60),host),false);
  assert.equal(ledger.entries.size,0);
});

test('C-01 binds the exact active mic to its frozen player turn and one STT',()=>{
  let now=1000,known=true;
  const ped=randomUUID(),host={hostRunId:randomUUID(),worldEpoch:1};
  const ledger=new UtteranceLifecycle({now:()=>now,current:ref=>known && ref===ped});
  const turn={pedId:'42',sessionNonce:2,turnId:'native-turn-1',generationId:3};
  const frame=(phase,terminal,time,id)=>({utteranceVersion:1,utteranceId:id,
    phase,terminal,hostRunId:host.hostRunId,worldEpoch:1,gameTick:100,
    monotonicMs:time,inputSource:'essential_mic',micPedRef:ped});
  const id=randomUUID();
  assert.equal(ledger.reserveMicTurn({identity:turn,actorRef:ped,...host},host),true);
  now=1050;assert.equal(ledger.accept(frame('started',null,100,id),host),true);
  assert.equal(ledger.diagnostics.joined,1);
  assert.equal(ledger.finishPcm(turn,3200),true);
  now=1250;assert.equal(ledger.accept(frame('ended','released',220,id),host),true);
  const result=ledger.acceptStt({identity:turn,text:'Where should we go?',host});
  assert.deepEqual(result,{accepted:true,utteranceId:id});
  assert.equal(ledger.entries.get(id).transcript.turn.turnId,turn.turnId);
  assert.equal(ledger.entries.get(id).transcript.text,'Where should we go?');
  assert.equal(ledger.acceptStt({identity:turn,text:'Different words',host}).accepted,false);
  assert.equal(ledger.diagnostics.sttAccepted,1);
});

test('C-01 accepts native-first matching only during the bounded open-mic window',()=>{
  let now=1000;const ped=randomUUID(),host={hostRunId:randomUUID(),worldEpoch:1};
  const turn={pedId:'42',sessionNonce:2,turnId:'mic',generationId:1};
  const ledger=new UtteranceLifecycle({now:()=>now,current:ref=>ref===ped}),id=randomUUID();
  const fact=(phase,terminal,time)=>({utteranceVersion:1,utteranceId:id,
    phase,terminal,hostRunId:host.hostRunId,worldEpoch:1,gameTick:100,
    monotonicMs:time,inputSource:'essential_mic',micPedRef:ped});
  assert.equal(ledger.accept(fact('started',null,100),host),true);
  now=1200;
  assert.equal(ledger.reserveMicTurn({identity:turn,actorRef:ped,...host},host),true);
  assert.equal(ledger.finishPcm(turn,2000),true);
  assert.equal(ledger.accept(fact('ended','released',200),host),true);
  assert.equal(ledger.acceptStt({identity:turn,text:'Hello',host}).accepted,true);
});

test('C-01 rejects mismatched actor, epoch, cancelled mic, wrong tuple and unfinished PCM',()=>{
  let now=1000,known=true;const ped=randomUUID(),other=randomUUID(),
    host={hostRunId:randomUUID(),worldEpoch:1};
  const turn={pedId:'42',sessionNonce:2,turnId:'mic',generationId:1};
  const ledger=new UtteranceLifecycle({now:()=>now,current:ref=>known && ref===ped});
  const f=(id,phase,terminal,ms,ref=ped)=>({utteranceVersion:1,utteranceId:id,
    phase,terminal,hostRunId:host.hostRunId,worldEpoch:1,gameTick:100,
    monotonicMs:ms,inputSource:'essential_mic',micPedRef:ref});
  assert.equal(ledger.reserveMicTurn({identity:turn,actorRef:other,...host},host),false);
  assert.equal(ledger.reserveMicTurn({identity:turn,actorRef:ped,hostRunId:randomUUID(),worldEpoch:1},host),false);
  assert.equal(ledger.reserveMicTurn({identity:turn,actorRef:ped,...host},host),true);
  const id=randomUUID();
  assert.equal(ledger.accept(f(id,'started',null,100),host),true);
  assert.equal(ledger.finishPcm({...turn,turnId:'other-turn'},1024),false);
  assert.equal(ledger.finishPcm(turn,1024),true);
  assert.equal(ledger.acceptStt({identity:{...turn,generationId:2},text:'X',host}).accepted,false);
  assert.equal(ledger.accept(f(id,'ended','released',200),host),true);
  known=false;
  assert.equal(ledger.acceptStt({identity:turn,text:'X',host}).accepted,false);
  assert.equal(ledger.cancelTurn(turn),false); // prior failure already retires lease

  const next=new UtteranceLifecycle({now:()=>now,current:ref=>ref===ped});
  assert.equal(next.reserveMicTurn({identity:turn,actorRef:ped,...host},host),true);
  const id2=randomUUID();
  assert.equal(next.accept(f(id2,'started',null,300),host),true);
  assert.equal(next.finishPcm(turn,1024),true);
  assert.equal(next.accept(f(id2,'ended','timeout',400),host),true);
  assert.equal(next.acceptStt({identity:turn,text:'Should not link',host}).accepted,false);
});

test('C-01 cancellation and world resets cannot reassign a previous mic to a new turn',()=>{
  let now=1000;const ped=randomUUID(),host={hostRunId:randomUUID(),worldEpoch:1};
  const turn={pedId:'42',sessionNonce:1,turnId:'a',generationId:1};
  const next={...turn,turnId:'b',generationId:2},id=randomUUID();
  const ledger=new UtteranceLifecycle({now:()=>now,current:ref=>ref===ped});
  const fact=(phase,terminal,ms)=>({utteranceVersion:1,utteranceId:id,
    phase,terminal,hostRunId:host.hostRunId,worldEpoch:1,gameTick:1,
    monotonicMs:ms,inputSource:'essential_mic',micPedRef:ped});
  assert.equal(ledger.reserveMicTurn({identity:turn,actorRef:ped,...host},host),true);
  assert.equal(ledger.accept(fact('started',null,1),host),true);
  assert.equal(ledger.cancelTurn(turn),true);
  assert.equal(ledger.reserveMicTurn({identity:next,actorRef:ped,...host},host),false);
  assert.equal(ledger.accept(fact('ended','released',10),host),true);
  assert.equal(ledger.acceptStt({identity:next,text:'Nope',host}).accepted,false);
  ledger.clear();
  assert.equal(ledger.entries.size,0);
  assert.equal(ledger.accept(fact('ended','released',10),host),false);
});

test('C-01 native pipe joins stay private without a PS2 transcript or salience grant',()=>{
  let now=1000;
  const {runtime,hello,frame,fact}=setup();
  const ref=randomUUID(),id=randomUUID(),turn={pedId:'abc123',sessionNonce:1,turnId:'m-2',generationId:2};
  // Match a single source-time Ped reference to the P0 observer's active ref.
  assert.equal(runtime.ingest(frame('anchors',[{captureRef:ref,kind:'ped',observer:true}]),{authenticated:true}),true);
  const input={identity:turn,actorRef:ref,hostRunId:hello.hostRunId,worldEpoch:hello.worldEpoch};
  assert.equal(runtime.utterances.reserveMicTurn(input,runtime.hostContext),true);
  assert.equal(runtime.ingest(frame('utterance',{...fact(id,'started',null,100),micPedRef:ref}),{authenticated:true}),true);
  assert.equal(runtime.utterances.finishPcm(turn,1280),true);
  assert.equal(runtime.ingest(frame('utterance',{...fact(id,'ended','released',200),micPedRef:ref}),{authenticated:true}),true);
  assert.equal(runtime.utterances.acceptStt({identity:turn,text:'Whisper near the friend',host:runtime.hostContext}).accepted,true);
  assert.equal(runtime.observations.entries.size,0);
  assert.equal(runtime.transcripts.entries.size,0);
  assert.equal(runtime.salience.ledger.size,0);
  assert.equal(runtime.capabilities.playerSpeech,false);
});
