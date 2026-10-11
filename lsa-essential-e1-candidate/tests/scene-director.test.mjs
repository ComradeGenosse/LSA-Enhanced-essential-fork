import test from 'node:test';
import assert from 'node:assert/strict';
import { selectDirectorIntent, DIRECTOR_SPEECH_LIMITS, directorSpeechLimitsForPreset } from '../src/perception/sceneDirector.mjs';

const speaker = 'd34713cd-ff8e-4ab3-9f83-241a8cf812c7';
const player = '24846870-fdcc-444f-9aca-7487d4c01048';
const observationId = 'c9f50874-c003-4437-a944-9200cf6e30e5';
const NOW = 100_000;
const facts = { speakerCaptureRef: speaker, playerCaptureRef: player, nowMonotonicMs: NOW };
function candidate(changes = {}) {
  return {
    entitlementCurrent: true,
    observedAtMonotonicMs: NOW - 300,
    observation: {
      observationId, revision: 1, observer: {captureRef: speaker,kind:'ped'},
      expiresAtMonotonicMs: NOW + 15_000,
      claims: [{certainty:'supported',evidence:{channel:'visual'}}],
    },
    decision: {
      observationId, revision: 1, decisionKey: 'opaque-decision-key',
      policyVersion: 1, response:'eligible', expiresAtMonotonicMs:NOW + 15_000,
    },
    situation: {
      lifetimeCurrent:true, channelHealthy:true, perceptionSupported:true,
      playerCaptureRef:player,
    },
    ...changes,
  };
}

test('returns bounded read-only speech proposal without instructions or effects', () => {
  const original = candidate();
  const proposal = selectDirectorIntent([original], facts);
  assert.equal(proposal.kind, 'speech');
  assert.equal(proposal.observationId, observationId);
  assert.equal(proposal.speakerCaptureRef, speaker);
  assert.equal(proposal.urgency, 'routine');
  assert.equal(proposal.expiresAtMonotonicMs, NOW + 9700);
  assert(Object.isFrozen(proposal));
  assert.equal('command' in proposal, false);
  assert.equal('activity' in proposal, false);
  assert.equal('prompt' in proposal, false);
  assert.equal(original.decision.response, 'eligible');
});

test('refuses stale, mismatched, unqualified or consumed observer evidence', () => {
  const original = candidate();
  const variants = [
    {entitlementCurrent:false},
    {observedAtMonotonicMs: NOW - 10_000},
    {observedAtMonotonicMs: NOW + 1},
    {observation:{...original.observation,observer:{captureRef:player,kind:'ped'}}},
    {observation:{...original.observation,revision:2}},
    {observation:{...original.observation,claims:[{certainty:'unknown',evidence:{channel:'visual'}}]}},
    {observation:{...original.observation,claims:[{certainty:'supported',evidence:{channel:'report'}}]}},
    {decision:{...original.decision,response:'none'}},
    {decision:{...original.decision,expiresAtMonotonicMs:NOW}},
    {situation:{...original.situation,channelHealthy:false}},
    {situation:{...original.situation,lifetimeCurrent:false}},
    {situation:{...original.situation,playerCaptureRef:speaker}},
  ];
  for (const variant of variants) assert.equal(selectDirectorIntent([candidate(variant)],facts),null,JSON.stringify(variant));
});

test('urgent is prioritized, expires within two seconds and never uses a fallback player', () => {
  const routine = candidate();
  const urgent = candidate({
    decision:{...routine.decision,response:'urgent'},
    observedAtMonotonicMs:NOW-500,
  });
  assert.equal(selectDirectorIntent([routine,urgent],facts)?.urgency,'urgent');
  assert.equal(selectDirectorIntent([urgent],facts)?.expiresAtMonotonicMs,NOW+1500);
  assert.equal(selectDirectorIntent([urgent],{...facts,playerCaptureRef:null}),null);
  assert.equal(selectDirectorIntent([candidate({...urgent,observedAtMonotonicMs:NOW-2000})],facts),null);
});

test('selection stays deterministic and safely bounded', () => {
  const base = candidate();
  const otherId = '3b74ae3d-819c-475b-b222-1793af3dddad';
  const other = candidate({observation:{...base.observation,observationId:otherId},decision:{...base.decision,observationId:otherId}});
  assert.deepEqual(selectDirectorIntent([other,base],facts),selectDirectorIntent([base,other],facts));
  assert.equal(selectDirectorIntent(Array.from({length:129},()=>base),facts),null);
  assert.equal(DIRECTOR_SPEECH_LIMITS.attemptsPerMinute,4);
  assert.equal(DIRECTOR_SPEECH_LIMITS.ticketTtlMs,2000);
});


test('testing chatter preset never widens PS3 event freshness or ticket lease',()=>{
 const normal=directorSpeechLimitsForPreset('normal'),testing=directorSpeechLimitsForPreset('testing');
 for(const key of ['urgentCandidateTtlMs','routineCandidateTtlMs','ticketTtlMs',
  'globalInFlight','sceneReservations','pendingTickets','attemptsPerMinute'])
  assert.equal(testing[key],normal[key],key);
 assert(Object.isFrozen(testing));
 assert.throws(()=>directorSpeechLimitsForPreset('unlimited'));
});
