// Provider-neutral EA0 delivery intent. No vendor text or serialized model value
// may impersonate a trusted intent: createDelivery is called only by trusted
// resolver code after validating native evidence and character ownership.
const VALUES = [
  'neutral', 'whisper', 'excited', 'fearful', 'angry',
  'amused', 'sad', 'sarcastic', 'concerned',
];
export const DELIVERY_VALUES = Object.freeze(VALUES);
export const DELIVERY_SOURCES = Object.freeze([
  'neutral', 'verified_scene', 'luna_hint', 'dialogue_cue', 'ephemeral_mood',
]);
export const DELIVERY_CONFIDENCES = Object.freeze(['supported', 'soft']);
export const DELIVERY_INTENSITIES = Object.freeze(['subtle', 'normal', 'expressive']);
export const EXPRESSIVE_DELIVERY_MODES = Object.freeze(['off', 'shadow', 'experimental']);
export const DEFAULT_EXPRESSIVE_DELIVERY_CONFIG = Object.freeze({
  mode: 'off',
  intensity: 'subtle',
  maxTaggedSegmentsPerTurn: 2,
});

const deliveryInstances = new WeakSet();
const CONFIG_KEYS = new Set([...Object.keys(DEFAULT_EXPRESSIVE_DELIVERY_CONFIG), 'lunaDeliveryVersion']);
const DELIVERY_KEYS = new Set([
  'version', 'value', 'source', 'confidence', 'intensity', 'evidenceRef',
]);
const EVIDENCE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function checkedRecord(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(label + ' must be a plain object.');
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    if (!allowed.has(key) || !Object.hasOwn(value, key) ||
        !Object.getOwnPropertyDescriptor(value, key)?.enumerable ||
        !Object.hasOwn(Object.getOwnPropertyDescriptors(value), key) ||
        !('value' in Object.getOwnPropertyDescriptor(value, key))) {
      throw new TypeError(label + ' has unknown or unsafe fields.');
    }
  }
}

export function normalizeExpressiveDeliveryConfig(input, { speechProvider = 'openai' } = {}) {
  if (input === undefined) input = {};
  checkedRecord(input, CONFIG_KEYS, 'expressiveDelivery');
  const mode = input.mode === undefined ? 'off' : input.mode;
  const intensity = input.intensity === undefined ? 'subtle' : input.intensity;
  const budget = input.maxTaggedSegmentsPerTurn === undefined ? 2 : input.maxTaggedSegmentsPerTurn;
  if (!EXPRESSIVE_DELIVERY_MODES.includes(mode))
    throw new TypeError('expressiveDelivery.mode must be off, shadow, or experimental.');
  if (!DELIVERY_INTENSITIES.includes(intensity))
    throw new TypeError('expressiveDelivery.intensity must be subtle, normal, or expressive.');
  if (typeof budget !== 'number' || !Number.isSafeInteger(budget) || budget < 0 || budget > 8)
    throw new TypeError('expressiveDelivery.maxTaggedSegmentsPerTurn must be an integer from 0 to 8.');
  const lunaVersion = input.lunaDeliveryVersion;
  if (lunaVersion !== undefined && lunaVersion !== 0 && lunaVersion !== 1)
    throw new TypeError('expressiveDelivery.lunaDeliveryVersion must be 0 or 1.');
  if (lunaVersion === 1 && mode !== 'experimental')
    throw new TypeError('Luna emotional intent requires experimental delivery mode.');
  // Switching the speech provider can never enable acting on OpenAI or Qwen.
  // Validate even when forcing mode off: bad configuration never passes silently.
  return Object.freeze({
    mode: speechProvider === 'elevenlabs' ? mode : 'off',
    intensity,
    maxTaggedSegmentsPerTurn: budget,
    ...(lunaVersion !== undefined ? {lunaDeliveryVersion:speechProvider === 'elevenlabs' ? lunaVersion : 0} : {}),
  });
}

// Factory is an internal trust boundary, NOT a parser for arbitrary Luna output.
// Future Luna hints must be mapped to validated enums by their owning agent.
export function createDelivery(input = {}) {
  checkedRecord(input, DELIVERY_KEYS, 'delivery');
  const version = input.version === undefined ? 1 : input.version;
  const value = input.value === undefined ? 'neutral' : input.value;
  const source = input.source === undefined ? 'neutral' : input.source;
  const confidence = input.confidence === undefined ? 'soft' : input.confidence;
  const intensity = input.intensity === undefined ? 'subtle' : input.intensity;
  const evidenceRef = input.evidenceRef ?? null;
  if (version !== 1) throw new TypeError('Unsupported delivery contract version.');
  if (!DELIVERY_VALUES.includes(value)) throw new TypeError('Unsupported delivery value.');
  if (!DELIVERY_SOURCES.includes(source)) throw new TypeError('Unsupported delivery source.');
  if (!DELIVERY_CONFIDENCES.includes(confidence)) throw new TypeError('Unsupported delivery confidence.');
  if (!DELIVERY_INTENSITIES.includes(intensity)) throw new TypeError('Unsupported delivery intensity.');
  if (evidenceRef !== null && (typeof evidenceRef !== 'string' || !EVIDENCE_REF.test(evidenceRef)))
    throw new TypeError('Invalid opaque delivery evidenceRef.');
  if ((source !== 'verified_scene' && evidenceRef !== null) ||
      (source !== 'verified_scene' && confidence === 'supported') ||
      (source === 'neutral' && value !== 'neutral') ||
      (source === 'verified_scene' && confidence !== 'supported')) {
    throw new TypeError('Delivery source and evidence confidence are inconsistent.');
  }
  const delivery = Object.freeze({ version, value, source, confidence, intensity, evidenceRef });
  deliveryInstances.add(delivery);
  return delivery;
}

export function isDelivery(value) {
  return value !== null && typeof value === 'object' && deliveryInstances.has(value);
}

export const NEUTRAL_DELIVERY = createDelivery();
