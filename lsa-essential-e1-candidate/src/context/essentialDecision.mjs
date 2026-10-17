import {renderKnowledge} from './knowledgeRenderer.mjs';
import {ACT5_SLOTS,validateAct5Choice} from '../activities/act5Dialogue.mjs';
import {captureReferenceMap} from './turnSnapshot.mjs';
import {composeKnowledgeInstruction,separateKnowledgeInstruction,KNOWLEDGE_GROUNDING} from './knowledgeInstructions.mjs';
import {KNOWLEDGE_LIMITS,jsonBytes} from './knowledgeSelector.mjs';
// Wire contract: delivery hints are proposed acting direction, never dialogue or evidence.
// Version zero is the unchanged legacy {text} segment protocol.
export const LUNA_SEGMENT_DELIVERY_V1 = Object.freeze([
  'neutral', 'whisper', 'excited', 'fearful', 'angry',
  'amused', 'sad', 'sarcastic', 'concerned',
]);

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

export function parseDecisionJson(raw, { act5Intents = null } = {}) {
  let value;
  try { value = JSON.parse(raw); }
  catch { throw new TypeError('Luna returned invalid decision JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Luna decision must be a JSON object.');
  const keys = Object.keys(value).sort();
  const act5 = Array.isArray(act5Intents);
  if (act5 ? keys.join(',') !== 'activity,command,dialogue' :
      keys.join(',') !== 'command,dialogue') throw new TypeError(act5
        ? 'Luna ACT5 decision must contain only activity, dialogue and command.'
        : 'Luna decision must contain only dialogue and command.');
  if (act5 && !validateAct5Choice(value.activity, act5Intents))
    throw new TypeError('Luna ACT5 activity is malformed or unavailable.');
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
  if (act5 && command && value.activity !== null)
    throw new TypeError('Luna ACT5 activity and stock DO command are mutually exclusive.');
  return Object.freeze({ dialogue, command, ...(act5 ? { activity: value.activity } : {}) });
}

export function validateDecisionShape(decision) {
  return parseDecisionJson(JSON.stringify(decision));
}

export function act5ActivitySchema(intents) {
  // Generate the strict model schema from exactly the same closed-slot map
  // used by acceptance validation. Never expose native steps or arbitrary refs.
  const exact = value => value && typeof value === 'object'
    ? { type:'object', additionalProperties:false, required:Object.keys(value),
        properties:Object.fromEntries(Object.entries(value).map(([key,part])=>[key,exact(part)])) }
    : { type:typeof value, enum:[value] };
  const choices = intents.map(intent => {
    if (!Object.hasOwn(ACT5_SLOTS,intent)) throw new TypeError('ACT5 unsupported intent');
    return { type:'object', additionalProperties:false, required:['intent','slots'],
      properties:{intent:{type:'string',enum:[intent]},slots:exact(ACT5_SLOTS[intent])} };
  });
  return { anyOf:[{type:'null'},...choices] };
}

export function withAct5Schema(schema, intents) {
  return Object.freeze({...schema,required:[...schema.required,'activity'],
    properties:{...schema.properties,activity:act5ActivitySchema(intents)}});
}

export function buildRequest({ model, effort, systemInstruction, actor, listener, world, contextText, internalEvent, source, input, history = [], maxOutputTokens = 300, structuredSegments = false, lunaDeliveryVersion = 0, knowledgeProjection, activityContext = null }) {
  if (lunaDeliveryVersion !== 0 && lunaDeliveryVersion !== 1)
    throw new RangeError('Unsupported Luna segment delivery protocol version.');
  if (lunaDeliveryVersion === 1 && !structuredSegments)
    throw new TypeError('Luna delivery hints require structured segments.');
  const act5 = activityContext && Array.isArray(activityContext.intents);
  const projection=knowledgeProjection ?? renderKnowledge({actor,listener,world,referenceMap:captureReferenceMap(actor),history,input,source:source||'player_text'});
  const allocation=projection.modelAllocation;
  if(!allocation || projection.frameVersion!==1)throw new TypeError('knowledge_projection_shape');
  const scene=allocation.scene;
  const boundedHistory=allocation.messages.slice(0,-1);
  let outputRules = structuredSegments
    ? (lunaDeliveryVersion === 1
      ? 'Return one strict JSON object with exactly three fields in this order: mode, segments, command. mode is dialogue_only only when no action is needed; otherwise buffered_action. Every segments item must contain exactly two fields in this order: delivery, text. delivery is a single acting-intent enum: neutral, whisper, excited, fearful, angry, amused, sad, sarcastic, concerned. Use neutral when unsure; never imply you witnessed events without verified evidence. Do not output bracketed audio tags or stage directions. text must be a complete short spoken phrase/sentence of at most 200 characters. Use multiple segments for longer speech (maximum six); keep combined speech under 1200 characters. command is empty or exactly one available Essential DO action. Never put DO commands in speech; never claim an action already happened. dialogue_only requires an empty command; mode cannot change.'
      : 'Return one strict JSON object with exactly three fields in this order: mode, segments, command. mode is dialogue_only only when no action is needed; otherwise buffered_action. Each segments item contains exactly text and must be a complete short spoken phrase/sentence of at most 200 characters. For longer speech, use multiple segments (maximum six total); do not put the whole long reply in one item. Keep combined speech under 1200 characters. command is empty or exactly one currently available Essential DO action. Never put DO commands in speech. Do not claim an action already happened. The mode is fixed and may not change; dialogue_only requires an empty final command.')
    : 'Return one JSON object with exactly two fields: dialogue and command. dialogue contains only brief spoken words for the player, never a DO command. command is empty or exactly one currently available Essential DO action. Do not chain actions. Do not invent targets, vehicles, weapons, or destinations.';
  if (act5) {
    outputRules = outputRules.replace('exactly three fields in this order: mode, segments, command.',
      'exactly four fields in this order: mode, segments, command, activity.')
      .replace('exactly two fields: dialogue and command.',
        'exactly three fields: dialogue, command, activity.');
    outputRules += ' ACT5: activity is null or ONE offered, closed intent/slot combination. An activity requires buffered_action (never early audio), an empty stock command, and a short natural invitation asking for player consent. The player has NOT approved yet. Never say it was executed. Do not propose while busy; do not invent targets, coordinates or capabilities.';
  }
  const act5Context = act5 ? '\n[ACT5 VERIFIED ACTIVITY OFFER]\n' +
    JSON.stringify({availableIntents:activityContext.intents,pendingIntent:activityContext.pendingIntent,
      ownActivityState:activityContext.activityStatus}) : '';
  const trustedInstruction=`${separateKnowledgeInstruction(systemInstruction)}\n\n[C-04 CONTEXT RULES]\n${KNOWLEDGE_GROUNDING}\n\n[E1 OUTPUT RULES]\n${outputRules}${act5Context}`;
  if(jsonBytes(trustedInstruction)>KNOWLEDGE_LIMITS.instructionBytes)throw new RangeError('knowledge_instruction_bytes');
  const body = {
    model,
    store: false,
    reasoning: { effort },
    stream: false,
    max_output_tokens: maxOutputTokens,
    text: { format: { type: 'json_schema', name: act5 ? (structuredSegments ? (lunaDeliveryVersion === 1 ? 'e1_act5_segmented_delivery_v1' : 'e1_act5_segmented_decision') : 'e1_act5_decision') :
        (structuredSegments ? (lunaDeliveryVersion === 1 ? 'e1_segmented_delivery_v1' : 'e1_segmented_decision') : 'e1_decision'), strict: true,
      schema: act5 ? withAct5Schema(structuredSegments ? (lunaDeliveryVersion === 1 ? segmentedDeliveryV1Schema : segmentedDecisionSchema) : decisionSchema, activityContext.intents) :
        (structuredSegments ? (lunaDeliveryVersion === 1 ? segmentedDeliveryV1Schema : segmentedDecisionSchema) : decisionSchema) } },
    input: [
      { role: 'system', content: composeKnowledgeInstruction(systemInstruction,scene,outputRules+act5Context) },
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

// EA3 opt-in strict schema. Strict Responses schemas require all fields, so
// neutral is explicit. Delivery precedes text for early segment release.
export const segmentedDeliveryV1Schema = Object.freeze({
  type: 'object', additionalProperties: false,
  required: ['mode', 'segments', 'command'],
  properties: {
    mode: { type: 'string', enum: ['dialogue_only', 'buffered_action'] },
    segments: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['delivery', 'text'],
      properties: {
        delivery: { type: 'string', enum: [...LUNA_SEGMENT_DELIVERY_V1] },
        text: { type: 'string' },
      },
    } },
    command: { type: 'string' },
  },
});
