import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// This evidence was extracted from PE/CLR metadata without loading the assembly.
// Both the DLL and the extraction artifact are independently pinned. A refreshed
// DLL or metadata file requires a deliberate review and contract update.
export const EXPECTED_NATIVE_METADATA_SHA256 = '18edd2b47ffde748388b07a4a2d023793e183b882fe638acb5276440d45a2d23';

export function validateNativeEvidence(evidence, dllHash) {
  if (evidence.dllSha256 !== dllHash) throw new Error('Native contract DLL fingerprint mismatch.');
  const type = name => {
    const match = evidence.types.filter(t => t.name === name);
    if (match.length !== 1) throw new Error(`Missing or ambiguous native contract type: ${name}`);
    return match[0];
  };
  const requireOne = (items, predicate, message) => {
    const matches = items.filter(predicate);
    if (matches.length !== 1) throw new Error(`${message}: expected one exact match; found ${matches.length}.`);
  };
  const playback = type('LosSantosAlive.Audio.NpcPlaybackCoordinator');
  const required = [
    ['TryAuthorizeTurn','Boolean',['Rage.Ped','String','Int64','String&','Rage.Ped','String','Boolean']],
    ['QueueTaggedAudioChunk','Boolean',['Byte[]','Rage.Ped','String','Int64','String&']],
    ['MarkStreamEnded','Boolean',['String','String','Int64','String&']],
    ['InterruptExactTurn','Boolean',['String','Rage.Ped','String','Int64','String']],
  ];
  for (const [name, returns, parameters] of required) {
    requireOne(playback.methods, m => m.name === name && m.returns === returns && JSON.stringify(m.parameters) === JSON.stringify(parameters), `Native signature mismatch or ambiguity: ${name}`);
  }
  for (const event of ['PlaybackStarted','PlaybackEnded']) requireOne(playback.methods, m => m.name === `add_${event}`, `Missing or ambiguous native event: ${event}`);
  const ended = type('LosSantosAlive.Audio.NpcPlaybackEndedEvent');
  for (const name of ['SpeakerPed','PedId','TurnId','GenerationId','Reason','WasInterrupted','HadAudio','PlaybackStarted']) requireOne(ended.fields, f => f.name === name, `Missing or ambiguous native completion field: ${name}`);
  const actions = type('LosSantosAlive.NPC.Actions.NpcActionRegistry');
  for (const name of ['HasAction','TryExecute']) requireOne(actions.methods, m => m.name === name, `Missing or ambiguous native action method: ${name}`);
  return { dllSha256: dllHash, protocolVersion: 3,
    authorization: 'npcAudioTurnStart -> npcAudioTurnAccepted/rejected', completion: 'npcPlaybackEnded',
    lifecycleFallback: false, methods: required.map(([name]) => name) };
}

export async function verifyNativeContract(dllHash, { metadataText, expectedMetadataSha256 = EXPECTED_NATIVE_METADATA_SHA256 } = {}) {
  const text = metadataText ?? await readFile(new URL('../docs/native-metadata.json', import.meta.url), 'utf8');
  const metadataSha256 = createHash('sha256').update(text).digest('hex');
  if (metadataSha256 !== expectedMetadataSha256) throw new Error(`Native metadata artifact fingerprint mismatch: expected ${expectedMetadataSha256}, found ${metadataSha256}.`);
  const evidence = JSON.parse(text);
  return { ...validateNativeEvidence(evidence, dllHash), metadataSha256 };
}
