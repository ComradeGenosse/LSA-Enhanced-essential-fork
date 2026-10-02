import test from 'node:test';
import assert from 'node:assert/strict';
import { actorVoiceTraits, ageBandFromAge, normalizeGender, parseAgeRange } from '../src/voice/actorVoiceTraits.mjs';

test('normalizes the exact native Essential gender vocabulary', () => {
  assert.equal(normalizeGender('male'), 'male');
  assert.equal(normalizeGender('female'), 'female');
  assert.equal(normalizeGender('unknown'), 'unknown');
});

test('keeps defensive gender aliases for compatibility', () => {
  assert.equal(normalizeGender('Male'), 'male');
  assert.equal(normalizeGender('FEMALE'), 'female');
  assert.equal(normalizeGender('m'), 'male');
  assert.equal(normalizeGender('f'), 'female');
});

test('maps the exact native Essential ageRange vocabulary', () => {
  assert.equal(parseAgeRange('young').ageBand, 'young');
  assert.equal(parseAgeRange('middle-aged').ageBand, 'mature');
  assert.equal(parseAgeRange('old').ageBand, 'older');
  assert.equal(parseAgeRange('unknown').ageBand, 'unknown');
});

test('parses numeric age ranges and exact ages', () => {
  assert.deepEqual(parseAgeRange('65-75'), { min: 65, max: 75, midpoint: 70, ageBand: 'older' });
  assert.deepEqual(parseAgeRange('75 to 65'), { min: 65, max: 75, midpoint: 70, ageBand: 'older' });
  assert.equal(parseAgeRange('26').ageBand, 'young');
  assert.equal(parseAgeRange('44 years old').ageBand, 'adult');
  assert.equal(parseAgeRange('45').ageBand, 'mature');
  assert.equal(parseAgeRange('60').ageBand, 'older');
  assert.equal(parseAgeRange('75').ageBand, 'senior');
});

test('normalizes textual age ranges defensively', () => {
  assert.equal(parseAgeRange('Young Adult').ageBand, 'young');
  assert.equal(parseAgeRange('Middle-Aged').ageBand, 'mature');
  assert.equal(parseAgeRange('Older Adult').ageBand, 'older');
  assert.equal(parseAgeRange('Elderly').ageBand, 'senior');
  assert.equal(parseAgeRange('Adult').ageBand, 'adult');
  assert.equal(parseAgeRange('???').ageBand, 'unknown');
});

test('actorVoiceTraits exposes only normalized demographic traits', () => {
  assert.deepEqual(actorVoiceTraits({
    gender: 'Female', ageRange: '60-70', roleContext: 'private', personaDescription: 'secret',
  }), { gender: 'female', ageBand: 'older', ageMin: 60, ageMax: 70 });
});

test('actorVoiceTraits preserves native old as a usable age signal', () => {
  assert.deepEqual(actorVoiceTraits({
    gender: 'male', ageRange: 'old',
  }), { gender: 'male', ageBand: 'older', ageMin: null, ageMax: null });
});

test('ageBandFromAge rejects implausible values', () => {
  assert.equal(ageBandFromAge(12), 'unknown');
  assert.equal(ageBandFromAge(111), 'unknown');
  assert.equal(ageBandFromAge('70'), 'older');
});
