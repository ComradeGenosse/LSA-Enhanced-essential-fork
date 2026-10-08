import {renderKnowledge} from './knowledgeRenderer.mjs';
import {captureReferenceMap} from './turnSnapshot.mjs';
import {composeKnowledgeInstruction,separateKnowledgeInstruction,KNOWLEDGE_GROUNDING} from './knowledgeInstructions.mjs';
import {KNOWLEDGE_LIMITS,jsonBytes} from './knowledgeSelector.mjs';
export const decisionSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['dialogue', 'command'],
  properties: {
    dialogue: { type: 'string' },
    command: { type: 'string' },
  },
});

export function extractResponseText(response) {
  if (!response || response.status !== 'completed') throw new TypeError('Luna response was not completed.');
  if (response.error) throw new TypeError('Luna response contains an error.');
  let refusal = false;
  const texts = [];
  for (const item of Array.isArray(response.output) ? response.output : []) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content?.type === 'refusal') refusal = true;
      if (content?.type === 'output_text' && typeof content.text === 'string') texts.push(content.text);
    }
  }
  if (refusal) throw new TypeError('Luna refused the request.');
  const text = texts.join('').trim();
  if (!text) throw new TypeError('Luna returned no decision text.');
  return text;
}

export function parseDecisionJson(raw) {
  let value;
  try { value = JSON.parse(raw); }
  catch { throw new TypeError('Luna returned invalid decision JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Luna decision must be a JSON object.');
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== 'command' || keys[1] !== 'dialogue') throw new TypeError('Luna decision must contain only dialogue and command.');
  if (typeof value.dialogue !== 'string' || typeof value.command !== 'string') throw new TypeError('Luna decision fields must be strings.');
  const dialogue = value.dialogue.trim();
  const command = value.command.trim();
  if (!dialogue || dialogue.length > 1200) throw new TypeError('Luna dialogue must contain 1 to 1200 characters.');
  if (command.length > 300 || (command && (!/^DO\s+[A-Za-z]/i.test(command) || /[|\r\n]/.test(command)))) {
    throw new TypeError('Luna command must be empty or one complete DO command.');
  }
  if (/(^|\n)\s*DO\s*:?\s+[A-Za-z]/i.test(dialogue) || dialogue.includes('|')) {
    throw new TypeError('Luna dialogue contains a control command.');
  }
  return Object.freeze({ dialogue, command });
}

export function validateDecisionShape(decision) {
  return parseDecisionJson(JSON.stringify(decision));
}

export function buildRequest({ model, effort, systemInstruction, actor, listener, world, contextText, internalEvent, source, input, history = [], maxOutputTokens = 300, structuredSegments = false, knowledgeProjection }) {
  const projection=knowledgeProjection ?? renderKnowledge({actor,listener,world,referenceMap:captureReferenceMap(actor),history,input,source:source||'player_text'});
  const allocation=projection.modelAllocation;
  if(!allocation || projection.frameVersion!==1)throw new TypeError('knowledge_projection_shape');
  const scene=allocation.scene;
  const boundedHistory=allocation.messages.slice(0,-1);
  const outputRules = structuredSegments
    ? 'Return one strict JSON object with exactly three fields in this order: mode, segments, command. mode is dialogue_only only when no action is needed; otherwise buffered_action. Each segments item contains exactly text and must be a complete short spoken phrase/sentence. command is empty or exactly one currently available Essential DO action. Never put DO commands in speech. Do not claim an action already happened. The mode is fixed and may not change; dialogue_only requires an empty final command.'
    : 'Return one JSON object with exactly two fields: dialogue and command. dialogue contains only brief spoken words for the player, never a DO command. command is empty or exactly one currently available Essential DO action. Do not chain actions. Do not invent targets, vehicles, weapons, or destinations.';
  const trustedInstruction=`${separateKnowledgeInstruction(systemInstruction)}\n\n[C-04 CONTEXT RULES]\n${KNOWLEDGE_GROUNDING}\n\n[E1 OUTPUT RULES]\n${outputRules}`;
  if(jsonBytes(trustedInstruction)>KNOWLEDGE_LIMITS.instructionBytes)throw new RangeError('knowledge_instruction_bytes');
  const body = {
    model,
    store: false,
    reasoning: { effort },
    stream: false,
    max_output_tokens: maxOutputTokens,
    text: { format: { type: 'json_schema', name: structuredSegments ? 'e1_segmented_decision' : 'e1_decision', strict: true,
      schema: structuredSegments ? segmentedDecisionSchema : decisionSchema } },
    input: [
      { role: 'system', content: composeKnowledgeInstruction(systemInstruction,scene,outputRules) },
      ...boundedHistory,
      { role:'user',content:allocation.messages.at(-1).content },
    ],
  };
  if (structuredSegments) body.stream = true;
  if (process.env.LSA_PROMPT_AUDIT === 'true') {
    const audit={label:'LSA PROMPT AUDIT — contains private character and user text',finalRequest:body};
    console.info('[LSA_PROMPT_AUDIT]\n' + JSON.stringify(audit,null,2));
  }
  if(jsonBytes(body)>KNOWLEDGE_LIMITS.requestBytes)throw new RangeError('knowledge_request_bytes');
  return body;
}

const segmentedDecisionSchema = Object.freeze({
  type: 'object', additionalProperties: false,
  required: ['mode', 'segments', 'command'],
  properties: {
    mode: { type: 'string', enum: ['dialogue_only', 'buffered_action'] },
    segments: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } },
    } },
    command: { type: 'string' },
  },
});
