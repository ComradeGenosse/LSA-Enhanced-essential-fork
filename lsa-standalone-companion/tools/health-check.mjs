import { randomUUID } from 'node:crypto';
import { Phase2NativeClient } from '../src/native/phase2Wire.mjs';

const fixtureTurn = process.argv.includes('--fixture-turn');
const client = new Phase2NativeClient();
try {
  const binding = await client.connect();
  const health = await client.request('health.ping');
  const snapshot = await client.request('host.snapshot');
  let verifiedTurn = false;
  if (fixtureTurn) {
    // This optional mode is ONLY for the isolated net481 test-harness process.
    // The production GTA plugin intentionally does not issue artificial turns.
    const offer = await client.request('turn.next');
    if (offer.status !== 'ok') throw new Error('fixture_offer_missing');
    const claims = {
      turnId: offer.turnId, sessionNonce: offer.sessionNonce,
      actorIncarnationId: offer.actorIncarnationId,
      leaseId: offer.leaseId, generation: offer.generation, source: offer.source
    };
    await (async () => {
      let spoofDenied = false;
      try { await client.request('turn.confirm', { ...claims, leaseId: randomUUID() }); }
      catch (error) { spoofDenied = error.message === 'native_rejected_invalid_ticket'; }
      if (!spoofDenied) throw new Error('forged_lease_accepted');
    })();
    const confirmed = await client.request('turn.confirm', claims);
    if (confirmed.status !== 'ok') throw new Error('fixture_confirm_failed');
    let replayDenied = false;
    try { await client.request('turn.confirm', claims); }
    catch (error) { replayDenied = error.message === 'native_rejected_invalid_ticket'; }
    if (!replayDenied) throw new Error('duplicate_confirmation_accepted');
    // The reply is only staged for Phase 4 playback; it is not a receipt
    // asserting that the NPC spoke or that dialogue history can be committed.
    const staged = await client.request('turn.reply', {
      turnId: claims.turnId, actorIncarnationId: claims.actorIncarnationId,
      leaseId: claims.leaseId, generation: claims.generation,
      replyText: 'Fixture answer, not played.'
    });
    if (staged.status !== 'staged_not_played') throw new Error('reply_not_staged');
    let duplicateDenied = false;
    try {
      await client.request('turn.reply', {
        turnId: claims.turnId, actorIncarnationId: claims.actorIncarnationId,
        leaseId: claims.leaseId, generation: claims.generation,
        replyText: 'Duplicate should fail.'
      });
    } catch (error) {
      duplicateDenied = error.message === 'native_rejected_reply_already_staged';
    }
    if (!duplicateDenied) throw new Error('duplicate_reply_accepted');
    const { sessionNonce, source, ...cancelClaims } = claims;
    const cancelled = await client.request('turn.cancel', cancelClaims);
    if (cancelled.status !== 'ok') throw new Error('fixture_cancel_failed');
    verifiedTurn = true;
  }
  console.log(JSON.stringify({
    status: health.status, hostRunId: binding.hostRunId,
    worldEpoch: binding.worldEpoch, trackedActors: snapshot.trackedActors,
    actorEffects: 'disabled', fixtureTurnVerified: verifiedTurn
  }));
} catch (error) {
  console.error('standalone_native_unavailable:' + error.message);
  process.exitCode = 1;
} finally {
  client.close();
}
