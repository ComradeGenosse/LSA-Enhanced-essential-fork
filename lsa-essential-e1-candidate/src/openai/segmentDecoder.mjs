import { parseDecisionJson } from '../context/essentialDecision.mjs';

const MAX_JSON_DEPTH = 32;

export function parseJsonNoDuplicateKeys(source) {
  const parser = new StrictJsonParser(String(source));
  const value = parser.parseValue();
  parser.skipWhitespace();
  if (parser.position !== parser.source.length) throw new Error("Structured response has trailing content.");
  return value;
}

export function createSegmentDecoder({
  maxSegments = 6,
  maxSegmentChars = 240,
  maxDialogueChars = 1200,
  maxResponseChars = 32_768,
} = {}) {
  let source = "";
  let emitted = 0;
  let first = null;
  let newSegments = [];

  return {
    append(delta) {
      if (typeof delta !== "string") throw new TypeError("Streaming text delta must be a string.");
      source += delta;
      if (source.length > maxResponseChars) throw new Error("Structured response exceeded the probe size limit.");
      const segments = extractCompleteSegments(source, maxSegments, maxSegmentChars, maxDialogueChars);
      while (emitted < segments.length) {
        const segment = Object.freeze({
          sequence: emitted + 1,
          text: segments[emitted].text,
        });
        emitted += 1;
        if (!first) first = segment;
        newSegments.push(segment);
      }
      return first;
    },
    takeNewSegments() {
      const result = newSegments;
      newSegments = [];
      return result;
    },
    finish() {
      const decision = parseJsonNoDuplicateKeys(source);
      validateDecision(decision, { maxSegments, maxSegmentChars, maxDialogueChars });
      if (decision.segments.length !== emitted) {
        throw new Error("Final segment count did not match the segments observed in the stream.");
      }
      const dialogue = decision.segments.map(segment => segment.text.trim()).join(' ');
      return Object.freeze({
        mode: decision.mode,
        segments: Object.freeze(decision.segments.map(segment => Object.freeze({ text: segment.text.trim() }))),
        decision: parseDecisionJson(JSON.stringify({ dialogue, command: decision.command })),
      });
    },
    get mode() { return extractMode(source); },
    get responseChars() { return source.length; },
    get text() { return source; },
  };
}

function validateDecision(value, { maxSegments, maxSegmentChars, maxDialogueChars }) {
  assertExactKeys(value, ['mode', 'segments', 'command'], 'decision');
  if (!['dialogue_only', 'buffered_action'].includes(value.mode)) throw new Error('Decision mode is invalid.');
  if (!Array.isArray(value.segments) || value.segments.length < 1 || value.segments.length > maxSegments) {
    throw new Error(`Decision must contain between 1 and ${maxSegments} speech segments.`);
  }
  let total = 0;
  for (const segment of value.segments) total += validateSegment(segment, maxSegmentChars);
  if (total > maxDialogueChars) throw new Error('Decision dialogue exceeds its size limit.');
  if (typeof value.command !== 'string' || value.command.length > 300) throw new Error('Decision command is invalid or too long.');
  if (value.mode === 'dialogue_only' && value.command.trim()) {
    throw new Error('Dialogue-only stream produced a command after speech was released.');
  }
}

function validateSegment(value, maxChars) {
  assertExactKeys(value, ['text'], 'segment');
  if (typeof value.text !== "string" || !value.text.trim() || value.text.length > maxChars) {
    throw new Error("Speech segment text is empty or exceeds the segment size limit.");
  }
  if (/[|\r\n\u0000-\u001f\u007f]/.test(value.text) || /(^|\n)\s*DO\s*:?\s+[A-Za-z]/i.test(value.text)) {
    throw new Error('Speech segment contains a control command or invalid character.');
  }
  return value.text.trim().length;
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label} object.`);
  const keys = Object.keys(value);
  if (keys.length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) {
    throw new Error(`${label} contains missing or extra fields.`);
  }
}

function extractCompleteSegments(source, maxSegments, maxChars, maxDialogueChars) {
  const arrayStart = locateSegmentsArray(source);
  if (arrayStart == null) return [];
  const segments = [];
  let position = arrayStart;
  while (position < source.length) {
    position = skipWhitespaceAndCommas(source, position);
    if (position >= source.length || source[position] === "]") break;
    if (source[position] !== "{") throw new Error("Speech segments must be JSON objects.");
    const end = findCompositeEnd(source, position);
    if (end == null) break;
    const segment = parseJsonNoDuplicateKeys(source.slice(position, end));
    validateSegment(segment, maxChars);
    segments.push(segment);
    if (segments.length > maxSegments) throw new Error(`Decision exceeded ${maxSegments} speech segments.`);
    if (segments.reduce((sum, item) => sum + item.text.trim().length, 0) > maxDialogueChars) throw new Error('Decision dialogue exceeds its size limit.');
    position = end;
  }
  return segments;
}

function locateSegmentsArray(source) {
  let position = skipWhitespace(source, 0);
  if (position >= source.length || source[position] !== "{") return null;
  position += 1;
  while (position < source.length) {
    position = skipWhitespaceAndCommas(source, position);
    if (position >= source.length || source[position] === "}") return null;
    const parsedKey = readString(source, position);
    if (!parsedKey) return null;
    position = skipWhitespace(source, parsedKey.end);
    if (position >= source.length || source[position] !== ":") return null;
    position = skipWhitespace(source, position + 1);
    if (parsedKey.value === "segments") return source[position] === "[" ? position + 1 : null;
    const end = findValueEnd(source, position);
    if (end == null) return null;
    position = end;
  }
  return null;
}

function extractMode(source) {
  const position = skipWhitespace(source, 0);
  if (source[position] !== '{') return null;
  const key = readString(source, skipWhitespace(source, position + 1));
  if (!key || key.value !== 'mode') return null;
  const colon = skipWhitespace(source, key.end);
  if (source[colon] !== ':') return null;
  const value = readString(source, skipWhitespace(source, colon + 1));
  return value && ['dialogue_only', 'buffered_action'].includes(value.value) ? value.value : null;
}

function findValueEnd(source, position) {
  position = skipWhitespace(source, position);
  if (position >= source.length) return null;
  if (source[position] === "{" || source[position] === "[") return findCompositeEnd(source, position);
  if (source[position] === '"') return readString(source, position)?.end ?? null;
  for (let i = position; i < source.length; i += 1) {
    if (source[i] === "," || source[i] === "}") return i;
  }
  return null;
}

function findCompositeEnd(source, start) {
  const stack = [];
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{" || char === "[") stack.push(char);
    else if (char === "}" || char === "]") {
      const opening = stack.pop();
      if ((char === "}" && opening !== "{") || (char === "]" && opening !== "[")) {
        throw new Error("Malformed structured response nesting.");
      }
      if (stack.length === 0) return i + 1;
    }
  }
  return null;
}

function readString(source, start) {
  if (source[start] !== '"') return null;
  let escaped = false;
  for (let i = start + 1; i < source.length; i += 1) {
    const char = source[i];
    if (escaped) escaped = false;
    else if (char === "\\") escaped = true;
    else if (char === '"') {
      const raw = source.slice(start, i + 1);
      try { return { value: JSON.parse(raw), end: i + 1 }; } catch { return null; }
    }
  }
  return null;
}

function skipWhitespace(source, position) {
  while (position < source.length && /\s/.test(source[position])) position += 1;
  return position;
}

function skipWhitespaceAndCommas(source, position) {
  while (position < source.length && (/\s/.test(source[position]) || source[position] === ",")) position += 1;
  return position;
}

class StrictJsonParser {
  constructor(source) { this.source = source; this.position = 0; }
  skipWhitespace() { this.position = skipWhitespace(this.source, this.position); }
  parseValue(depth = 0) {
    if (depth > MAX_JSON_DEPTH) throw new Error("Structured response nesting limit exceeded.");
    this.skipWhitespace();
    const char = this.source[this.position];
    if (char === "{") return this.parseObject(depth + 1);
    if (char === "[") return this.parseArray(depth + 1);
    if (char === '"') return this.parseString();
    if (char === "t") return this.parseLiteral("true", true);
    if (char === "f") return this.parseLiteral("false", false);
    if (char === "n") return this.parseLiteral("null", null);
    return this.parseNumber();
  }
  parseObject(depth) {
    this.position += 1;
    const result = {};
    const keys = new Set();
    this.skipWhitespace();
    if (this.source[this.position] === "}") { this.position += 1; return result; }
    while (true) {
      this.skipWhitespace();
      if (this.source[this.position] !== '"') throw new Error("Structured response object key is invalid.");
      const key = this.parseString();
      if (keys.has(key)) throw new Error(`Structured response contains duplicate key "${key}".`);
      keys.add(key);
      this.skipWhitespace();
      if (this.source[this.position] !== ":") throw new Error("Structured response is missing a colon.");
      this.position += 1;
      Object.defineProperty(result, key, {
        value: this.parseValue(depth),
        enumerable: true,
        writable: true,
        configurable: true,
      });
      this.skipWhitespace();
      const char = this.source[this.position++];
      if (char === "}") return result;
      if (char !== ",") throw new Error("Structured response object is incomplete.");
    }
  }
  parseArray(depth) {
    this.position += 1;
    const result = [];
    this.skipWhitespace();
    if (this.source[this.position] === "]") { this.position += 1; return result; }
    while (true) {
      result.push(this.parseValue(depth));
      this.skipWhitespace();
      const char = this.source[this.position++];
      if (char === "]") return result;
      if (char !== ",") throw new Error("Structured response array is incomplete.");
    }
  }
  parseString() {
    const parsed = readString(this.source, this.position);
    if (!parsed) throw new Error("Structured response string is malformed or incomplete.");
    this.position = parsed.end;
    return parsed.value;
  }
  parseLiteral(literal, value) {
    if (this.source.slice(this.position, this.position + literal.length) !== literal) throw new Error("Structured response contains an invalid literal.");
    this.position += literal.length;
    return value;
  }
  parseNumber() {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.source.slice(this.position));
    if (!match) throw new Error("Structured response contains an invalid number.");
    this.position += match[0].length;
    return Number(match[0]);
  }
}

export const __test = { extractCompleteSegments, findCompositeEnd, validateDecision };
