// Companion-only radio metadata. Native code never sends artist/title. R3 may
// use this bounded resolver when creating PS2 radio_heard observations; it is
// still not a prompt, memory, network lookup, or autonomous-response path.
export const RADIO_CATALOG_LIMITS = Object.freeze({
  tracks: 4096,
  bytes: 1024 * 1024,
  station: 64,
  stationName: 80,
  artist: 120,
  title: 160,
  generatedFrom: 80,
});

const STATION = /^[A-Z0-9_]{1,64}$/;
const HEX_KEY = /^[0-9A-F]{8}$/;
const PROVENANCE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const ENTRY_FIELDS = ['station', 'stationName', 'artist', 'title'];
const TOP_FIELDS = ['version', 'game', 'generatedFrom', 'tracks'];
const INPUT_FIELDS = ['version', 'game', 'generatedFrom', 'tracks'];
const ROW_FIELDS = ['station', 'stationName', 'trackHash', 'artist', 'title'];

const saturate = value => Math.min(2147483647, value + 1);

function ownKeys(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : null;
}

function exactKeys(value, allowed) {
  const keys = ownKeys(value);
  return keys !== null && keys.length === allowed.length && allowed.every(key => Object.hasOwn(value, key)) && keys.every(key => allowed.includes(key));
}

function wellFormed(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function displayText(value, max) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || !wellFormed(value)) return false;
  if (value.includes('://') || value.includes('\\') || value.includes('/') || value.includes('\n') || value.includes('\r')) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

export function radioTrackKey(trackHash) {
  if (typeof trackHash !== 'number' || !Number.isSafeInteger(trackHash) || trackHash < 0 || trackHash > 0xffffffff) return null;
  return trackHash.toString(16).padStart(8, '0').toUpperCase();
}

function push(errors, token) {
  if (errors.length < 32 && !errors.includes(token)) errors.push(token);
}

function requireText(value, max, blankToken, errors) {
  if (typeof value !== 'string' || value.length < 1) { push(errors, blankToken); return; }
  if (!displayText(value, max)) push(errors, 'unsafe_text');
}

function checkEntry(key, entry, errors) {
  if (!HEX_KEY.test(key) || key === '00000000') { push(errors, 'malformed_track_key'); return; }
  if (!exactKeys(entry, ENTRY_FIELDS)) { push(errors, 'unexpected_entry_field'); return; }
  if (!STATION.test(entry.station)) push(errors, 'malformed_station');
  requireText(entry.stationName, RADIO_CATALOG_LIMITS.stationName, 'blank_station_name', errors);
  requireText(entry.artist, RADIO_CATALOG_LIMITS.artist, 'blank_artist', errors);
  requireText(entry.title, RADIO_CATALOG_LIMITS.title, 'blank_title', errors);
}

export function verifyRadioTrackCatalog(value) {
  const errors = [];
  const keys = ownKeys(value);
  if (keys === null || keys.some(key => !TOP_FIELDS.includes(key)) || !Object.hasOwn(value, 'version') || !Object.hasOwn(value, 'game') || !Object.hasOwn(value, 'tracks')) {
    return { ok: false, errors: ['unexpected_catalog_field'] };
  }
  if (value.version !== 1) push(errors, 'invalid_version');
  if (value.game !== 'gta-v-enhanced') push(errors, 'invalid_game');
  if (Object.hasOwn(value, 'generatedFrom') && (typeof value.generatedFrom !== 'string' || !PROVENANCE.test(value.generatedFrom))) push(errors, 'invalid_provenance');
  const tracks = value.tracks;
  const trackKeys = ownKeys(tracks);
  if (trackKeys === null) {
    push(errors, 'invalid_tracks');
    return { ok: false, errors };
  }
  if (trackKeys.length > RADIO_CATALOG_LIMITS.tracks) {
    push(errors, 'too_many_tracks');
    return { ok: false, errors };
  }
  const sorted = [...trackKeys].sort();
  if (trackKeys.some((key, index) => key !== sorted[index])) push(errors, 'unordered_tracks');
  for (const key of trackKeys) checkEntry(key, tracks[key], errors);
  if (errors.length === 0) {
    const bytes = Buffer.byteLength(serializeRadioTrackCatalog(value));
    if (bytes > RADIO_CATALOG_LIMITS.bytes) push(errors, 'catalog_too_large');
  }
  return { ok: errors.length === 0, errors };
}

export function serializeRadioTrackCatalog(catalog) {
  const tracks = {};
  for (const key of Object.keys(catalog.tracks).sort()) {
    const entry = catalog.tracks[key];
    tracks[key] = { station: entry.station, stationName: entry.stationName, artist: entry.artist, title: entry.title };
  }
  const body = { version: 1, game: 'gta-v-enhanced' };
  if (Object.hasOwn(catalog, 'generatedFrom')) body.generatedFrom = catalog.generatedFrom;
  body.tracks = tracks;
  return JSON.stringify(body, null, 2) + '\n';
}

export function verifyRadioTrackCatalogText(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > RADIO_CATALOG_LIMITS.bytes || text.charCodeAt(0) === 0xfeff) {
    return { ok: false, errors: ['invalid_catalog_text'] };
  }
  let value;
  try { value = JSON.parse(text); } catch { return { ok: false, errors: ['invalid_catalog_text'] }; }
  const verified = verifyRadioTrackCatalog(value);
  if (!verified.ok) return verified;
  if (text !== serializeRadioTrackCatalog(value)) return { ok: false, errors: ['not_canonical'] };
  return { ok: true, errors: [] };
}

function parseTrackHash(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 0xffffffff) return null;
    return value;
  }
  if (typeof value === 'string' && /^[0-9A-Fa-f]{8}$/.test(value)) {
    const parsed = Number.parseInt(value, 16);
    return parsed > 0 && parsed <= 0xffffffff ? parsed : null;
  }
  return null;
}

export function buildRadioTrackCatalog(input) {
  const errors = [];
  if (!exactKeys(input, INPUT_FIELDS)) return { ok: false, errors: ['unexpected_input_field'] };
  if (input.version !== 1) push(errors, 'invalid_version');
  if (input.game !== 'gta-v-enhanced') push(errors, 'invalid_game');
  if (typeof input.generatedFrom !== 'string' || !PROVENANCE.test(input.generatedFrom)) push(errors, 'invalid_provenance');
  if (!Array.isArray(input.tracks)) {
    push(errors, 'invalid_tracks');
    return { ok: false, errors };
  }
  if (input.tracks.length > RADIO_CATALOG_LIMITS.tracks) {
    push(errors, 'too_many_tracks');
    return { ok: false, errors };
  }
  const tracks = {};
  const counts = Object.create(null);
  let duplicates = 0;
  for (const row of input.tracks) {
    if (!exactKeys(row, ROW_FIELDS)) { push(errors, 'unexpected_entry_field'); continue; }
    const hash = parseTrackHash(row.trackHash);
    const key = hash === null ? null : radioTrackKey(hash);
    if (key === null || key === '00000000') { push(errors, 'malformed_track_key'); continue; }
    if (!STATION.test(row.station)) push(errors, 'malformed_station');
    requireText(row.stationName, RADIO_CATALOG_LIMITS.stationName, 'blank_station_name', errors);
    requireText(row.artist, RADIO_CATALOG_LIMITS.artist, 'blank_artist', errors);
    requireText(row.title, RADIO_CATALOG_LIMITS.title, 'blank_title', errors);
    if (Object.hasOwn(tracks, key)) { duplicates++; push(errors, 'duplicate_track'); continue; }
    tracks[key] = { station: row.station, stationName: row.stationName, artist: row.artist, title: row.title };
    counts[row.station] = (counts[row.station] ?? 0) + 1;
  }
  if (errors.length > 0) return { ok: false, errors, duplicates, unknown: 0 };
  const ordered = {};
  for (const key of Object.keys(tracks).sort()) ordered[key] = tracks[key];
  const catalog = { version: 1, game: 'gta-v-enhanced', generatedFrom: input.generatedFrom, tracks: ordered };
  const verified = verifyRadioTrackCatalog(catalog);
  if (!verified.ok) return { ok: false, errors: verified.errors, duplicates, unknown: 0 };
  const countsByStation = {};
  for (const station of Object.keys(counts).sort()) countsByStation[station] = counts[station];
  return {
    ok: true,
    errors: [],
    json: serializeRadioTrackCatalog(catalog),
    trackCount: Object.keys(tracks).length,
    countsByStation,
    duplicates: 0,
    // No Rockstar master list is available, so there is nothing honest to mark unknown here.
    unknown: 0,
  };
}

export class RadioTrackCatalog {
  constructor(raw, loaded) {
    const tracks = Object.create(null);
    const source = raw?.tracks && typeof raw.tracks === 'object' && !Array.isArray(raw.tracks) ? raw.tracks : {};
    for (const key of Object.keys(source).sort()) {
      const entry = source[key];
      tracks[key] = Object.freeze({
        station: entry.station,
        stationName: entry.stationName,
        artist: entry.artist,
        title: entry.title,
      });
    }
    this.loaded = loaded === true;
    this.version = 1;
    this.game = 'gta-v-enhanced';
    this.tracks = Object.freeze(tracks);
    this.unknownTracks = 0;
    this.catalogMismatches = 0;
  }

  static unavailable() {
    return new RadioTrackCatalog({ tracks: {} }, false);
  }

  resolve(station, trackHash) {
    const key = radioTrackKey(trackHash);
    const safeStation = typeof station === 'string' && STATION.test(station) ? station : '';
    const safeHash = key === null ? 0 : trackHash;
    const unknown = mismatch => {
      if (mismatch) this.catalogMismatches = saturate(this.catalogMismatches);
      else this.unknownTracks = saturate(this.unknownTracks);
      const result = { station: safeStation, trackHash: safeHash, trackKey: key ?? '00000000', trackKnown: false };
      if (mismatch) result.catalogMismatch = true;
      return Object.freeze(result);
    };
    if (key === null || trackHash === 0 || safeStation.length === 0) return unknown(false);
    const entry = this.tracks[key];
    if (!entry) return unknown(false);
    if (entry.station !== station) return unknown(true);
    return Object.freeze({
      station,
      stationName: entry.stationName,
      trackHash,
      trackKey: key,
      trackKnown: true,
      artist: entry.artist,
      title: entry.title,
    });
  }
}

export function loadRadioTrackCatalog(text) {
  const verified = verifyRadioTrackCatalogText(text);
  if (!verified.ok) return RadioTrackCatalog.unavailable();
  return new RadioTrackCatalog(JSON.parse(text), true);
}

export function resolveRadioTrack(input, catalog) {
  const source = catalog ?? RadioTrackCatalog.unavailable();
  return source.resolve(input?.station, input?.trackHash);
}

export function normalizeRadioSignal(signal, catalog) {
  if (!signal || signal.producer !== 'radio' || signal.source !== null || !signal.facts) return null;
  const sourceVehicleCaptureRef = signal.target ?? null;
  if (signal.kind === 'radio_stopped') {
    if (signal.facts.station !== '' || signal.facts.trackHash !== 0) return null;
    return Object.freeze({
      eventSignalId: signal.signalId,
      kind: 'radio_audio',
      soundKind: 'radio',
      gameTick: signal.gameTick,
      sourceVehicleCaptureRef,
      station: '',
      trackHash: 0,
      trackKey: '00000000',
      trackKnown: false,
    });
  }
  if (signal.kind !== 'radio_changed') return null;
  const resolved = (catalog ?? RadioTrackCatalog.unavailable()).resolve(signal.facts.station, signal.facts.trackHash);
  return Object.freeze({
    eventSignalId: signal.signalId,
    kind: 'radio_audio',
    soundKind: 'radio',
    gameTick: signal.gameTick,
    sourceVehicleCaptureRef,
    ...resolved,
  });
}
