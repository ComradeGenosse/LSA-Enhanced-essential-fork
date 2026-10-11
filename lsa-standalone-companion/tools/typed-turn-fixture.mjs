import { Phase2NativeClient } from '../src/native/phase2Wire.mjs';
import { PendingDialogue, handleNextTypedTurn } from '../src/conversation/typedTurn.js.mjs';

// Explicit fixture only. Does not call OpenAI or claim GTA audio playback.
const client = new Phase2NativeClient();
const pending = new PendingDialogue();
try {
  await client.connect();
  const outcome = await handleNextTypedTurn(client, {
    async complete({ text }) { return 'Fixture understood: ' + text; }
  }, { pending });
  if (outcome.state !== 'staged_not_played' || pending.pendingCount !== 1)
    throw new Error('fixture_incomplete');
  console.log(JSON.stringify({ result: outcome.state, pending: pending.pendingCount,
    playback: 'not_attempted', history: 'uncommitted' }));
} catch (error) {
  console.error('typed_fixture_failed:' + error.message);
  process.exitCode = 1;
} finally {
  pending.retireAll();
  client.close();
}
