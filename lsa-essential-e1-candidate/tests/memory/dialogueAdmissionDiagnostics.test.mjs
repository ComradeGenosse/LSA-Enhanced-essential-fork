import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createD03OriginalDialogueJoin} from '../../src/memory/d03OriginalDialogueJoin.mjs';
import {sanitizeTelemetryData} from '../../src/observability/eventContract.mjs';

test('refused timeline admission reports a safe reason without invoking native lease or writing data',()=>{
  let leases=0;
  for(const pending of ['native_source_confirmation_required','native_source_unavailable','clock_regression']){
    const reasons=[];
    const join=createD03OriginalDialogueJoin({
      store:{timelineWritable:false,timelinePendingReason:pending},
      backend:{source:{acceptedSourceHookAvailable:true},hasAuthenticatedSource:()=>true,verifyAccepted:()=>null},
      d02:{bindActorAtTurnStart:()=>{leases++;},verifyCurrentOwnerAndPlayer:()=>null},
      originalActor:{resolveAtTurnStart:()=>null},onDiagnostic:r=>reasons.push(r)
    });
    assert.equal(join.begin({identity:{pedId:'00049302',turnId:'test',generationId:1,sessionNonce:1},
      characterId:randomUUID(),ownerAlias:'promoted.'+randomUUID(),isCurrent:()=>true}),null);
    assert.deepEqual(reasons,['d03_'+pending]);
    assert.equal(sanitizeTelemetryData({role:'player',reason:reasons[0]}).reason,reasons[0]);
  }
  assert.equal(leases,0);
});

test('a failed diagnostic callback cannot change denied admission',()=>{
  const join=createD03OriginalDialogueJoin({store:{timelineWritable:false},
    backend:{source:{acceptedSourceHookAvailable:true},hasAuthenticatedSource:()=>true,verifyAccepted:()=>null},
    onDiagnostic:()=>{throw Error('diagnostic sink failed');}});
  assert.equal(join.begin(),null);
});
