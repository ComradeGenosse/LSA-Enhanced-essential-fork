import test from 'node:test';
import assert from 'node:assert/strict';
import {composeKnowledgeInstruction,stripLegacyPipeActionInstructions}
  from '../src/context/knowledgeInstructions.mjs';
import {parseDecisionJson} from '../src/context/essentialDecision.mjs';

test('legacy pipe examples are removed while persona and strict JSON rules survive',()=>{
 const instruction=['You are Nathan, a persistent companion.',
  'Actions must use DO Action|Speech.',
  'Example: DO FollowTarget A|Right behind you.',
  'Keep your dry sense of humor.'].join('\n');
 const composed=composeKnowledgeInstruction(instruction,'{"frameVersion":1}',
  'Return exactly the JSON fields mode, segments, command.');
 assert.match(composed,/You are Nathan/);
 assert.match(composed,/Keep your dry sense of humor/);
 assert.doesNotMatch(composed,/DO Action\|Speech|FollowTarget A\|/);
 assert.match(composed,/mode, segments, command/);
 assert.equal(stripLegacyPipeActionInstructions('Do not repeat "red|blue" in dialogue.'),
  'Do not repeat "red|blue" in dialogue.');
 assert.equal(stripLegacyPipeActionInstructions('Never emit DO FollowTarget A|spoken text.'),
  'Never emit DO FollowTarget A|spoken text.');
 assert.equal(stripLegacyPipeActionInstructions('Keep Nathan curious. Example: DO FollowTarget A|spoken text.'),
  'Keep Nathan curious.');
 assert.equal(stripLegacyPipeActionInstructions('Keep his humor intact; Example: DO FollowTarget A|spoken text.'),
  'Keep his humor intact;');
});
test('public model output remains JSON; legacy pipe is only an internal stock transcript',()=>{
 assert.deepEqual(parseDecisionJson('{"dialogue":"Right behind you.","command":"DO FollowTarget A"}'),
  {dialogue:'Right behind you.',command:'DO FollowTarget A'});
 assert.throws(()=>parseDecisionJson('DO FollowTarget A|Right behind you.'),/invalid decision JSON/);
});
