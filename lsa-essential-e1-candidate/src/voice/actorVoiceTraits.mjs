const AGE_BANDS = Object.freeze(['young', 'adult', 'mature', 'older', 'senior']);

function validAge(age) {
  return Number.isFinite(age) && age >= 13 && age <= 110;
}

function frozenAge({ min = null, max = null, midpoint = null, ageBand = 'unknown' } = {}) {
  return Object.freeze({ min, max, midpoint, ageBand });
}

export function normalizeGender(value) {
  const gender = String(value ?? '').trim().toLowerCase();
  if (['male', 'man', 'm'].includes(gender)) return 'male';
  if (['female', 'woman', 'f'].includes(gender)) return 'female';
  return 'unknown';
}

export function ageBandFromAge(age) {
  const number = Number(age);
  if (!validAge(number)) return 'unknown';
  if (number < 30) return 'young';
  if (number < 45) return 'adult';
  if (number < 60) return 'mature';
  if (number < 75) return 'older';
  return 'senior';
}

export function parseAgeRange(value) {
  const raw = String(value ?? '').trim();
  const text = raw.toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ');
  if (!text || ['unknown', 'n/a', 'na', 'none', 'unspecified'].includes(text)) return frozenAge();

  const range = text.match(/\b(\d{1,3})\s*(?:-|–|—|to)\s*(\d{1,3})\b/i);
  if (range) {
    let min = Number(range[1]);
    let max = Number(range[2]);
    if (min > max) [min, max] = [max, min];
    if (validAge(min) && validAge(max)) {
      const midpoint = (min + max) / 2;
      return frozenAge({ min, max, midpoint, ageBand: ageBandFromAge(midpoint) });
    }
  }

  const exact = text.match(/^\s*(\d{1,3})(?:\s*(?:years?|yrs?)\s*old)?\s*$/i);
  if (exact) {
    const age = Number(exact[1]);
    if (validAge(age)) return frozenAge({ min: age, max: age, midpoint: age, ageBand: ageBandFromAge(age) });
  }

  const collapsed = text.replace(/[^a-z]/g, '');
  if (/(elderly|senior|geriatric)/.test(collapsed)) return frozenAge({ ageBand: 'senior' });
  if (/(olderadult|older)/.test(collapsed)) return frozenAge({ ageBand: 'older' });
  if (/(middleaged|middleage|mature)/.test(collapsed)) return frozenAge({ ageBand: 'mature' });
  if (/(youngadult|young|teen|adolescent)/.test(collapsed)) return frozenAge({ ageBand: 'young' });
  if (/(adult)/.test(collapsed)) return frozenAge({ ageBand: 'adult' });

  return frozenAge();
}

export function actorVoiceTraits(actor = {}) {
  const age = parseAgeRange(actor?.ageRange);
  return Object.freeze({
    gender: normalizeGender(actor?.gender),
    ageBand: age.ageBand,
    ageMin: age.min,
    ageMax: age.max,
  });
}

export { AGE_BANDS };
