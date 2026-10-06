import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RADIO_CATALOG_LIMITS, buildRadioTrackCatalog, loadRadioTrackCatalog, normalizeRadioSignal,
  resolveRadioTrack, verifyRadioTrackCatalog, verifyRadioTrackCatalogText,
} from '../src/perception/radioTrackCatalog.mjs';

const fixtureUrl = new URL('./fixtures/radio-tracks.v1.json', import.meta.url);
const productionUrl = new URL('../data/radioTracks.v1.json', import.meta.url);
const row = (patch = {}) => ({ station: 'RADIO_TEST_A', stationName: 'Test Radio', trackHash: 1, artist: 'Artist A', title: 'Track A', ...patch });
const input = (tracks, patch = {}) => ({ version: 1, game: 'gta-v-enhanced', generatedFrom: 'synthetic-fixture', tracks, ...patch });

async function walk(dir) {
  const files = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

test('synthetic catalog resolves known tracks and fails closed otherwise', async () => {
  const text = await readFile(fixtureUrl, 'utf8');
  assert.equal(verifyRadioTrackCatalogText(text).ok, true);
  const catalog = loadRadioTrackCatalog(text);
  assert.equal(catalog.loaded, true);
  const known = catalog.resolve('RADIO_TEST_A', 1);
  assert.deepEqual(known, { station: 'RADIO_TEST_A', stationName: 'Test Radio', trackHash: 1, trackKey: '00000001', trackKnown: true, artist: 'Artist A', title: 'Track A' });
  assert.throws(() => { known.artist = 'changed'; });
  assert.equal(catalog.tracks['00000001'].artist, 'Artist A');
  const facts = { station: 'RADIO_TEST_A', trackHash: 1 };
  const before = { ...facts };
  assert.equal(resolveRadioTrack(facts, catalog).trackKnown, true);
  assert.deepEqual(facts, before);
  const unknown = catalog.resolve('RADIO_TEST_A', 99);
  assert.equal(unknown.trackKnown, false);
  assert.equal(unknown.trackKey, '00000063');
  assert.equal('artist' in unknown, false);
  assert.equal('catalogMismatch' in unknown, false);
  const mismatch = catalog.resolve('RADIO_TEST_B', 1);
  assert.equal(mismatch.trackKnown, false);
  assert.equal(mismatch.catalogMismatch, true);
  assert.equal('title' in mismatch, false);
  const zero = catalog.resolve('RADIO_TEST_A', 0);
  assert.equal(zero.trackKnown, false);
  assert.equal('catalogMismatch' in zero, false);
  assert.equal(catalog.resolve('RADIO_TEST_B', 0x2).trackKey, '00000002');
  assert.equal(catalog.unknownTracks, 2);
  assert.equal(catalog.catalogMismatches, 1);
  const missing = loadRadioTrackCatalog('{');
  assert.equal(missing.loaded, false);
  assert.equal(missing.resolve('RADIO_TEST_A', 1).trackKnown, false);
});

test('radio normalization copies no guessed metadata and does not mutate the signal', async () => {
  const catalog = loadRadioTrackCatalog(await readFile(fixtureUrl, 'utf8'));
  const signal = { signalId: 'sig', producer: 'radio', kind: 'radio_changed', source: null, target: 'veh', gameTick: 4, facts: { station: 'RADIO_TEST_A', trackHash: 99 } };
  const normalized = normalizeRadioSignal(signal, catalog);
  assert.equal(normalized.trackKnown, false);
  assert.equal(normalized.kind, 'radio_audio');
  assert.equal('artist' in normalized, false);
  assert.equal(signal.facts.trackHash, 99);
  const known = normalizeRadioSignal({ ...signal, facts: { station: 'RADIO_TEST_A', trackHash: 1 } }, catalog);
  assert.equal(known.artist, 'Artist A');
  assert.equal(known.title, 'Track A');
  const stopped = normalizeRadioSignal({ ...signal, kind: 'radio_stopped', facts: { station: '', trackHash: 0 } }, catalog);
  assert.equal(stopped.trackKnown, false);
  assert.equal(stopped.station, '');
  assert.equal('artist' in stopped, false);
  assert.equal(normalizeRadioSignal({ ...signal, source: 'ped' }, catalog), null);
  assert.equal(normalizeRadioSignal({ ...signal, producer: 'state' }, catalog), null);
});

test('catalog generation is deterministic and rejects closed-schema failures', async () => {
  const forward = input([
    row({ station: 'RADIO_TEST_B', stationName: 'Test Radio B', trackHash: '00000002', artist: 'Artist B', title: 'Track B' }),
    row(),
  ]);
  const reverse = input([row(), row({ station: 'RADIO_TEST_B', stationName: 'Test Radio B', trackHash: 2, artist: 'Artist B', title: 'Track B' })]);
  const first = buildRadioTrackCatalog(forward);
  const second = buildRadioTrackCatalog(reverse);
  assert.equal(first.ok, true);
  assert.equal(first.json, second.json);
  assert.equal(first.json, await readFile(fixtureUrl, 'utf8'));
  assert.deepEqual(first.countsByStation, { RADIO_TEST_A: 1, RADIO_TEST_B: 1 });
  assert.equal(first.duplicates, 0);
  assert.equal(first.unknown, 0);
  const high = buildRadioTrackCatalog(input([row({ trackHash: 0xffffffff })]));
  assert.equal(high.ok, true);
  assert.match(high.json, /"FFFFFFFF"/);
  const rejected = [
    input([row(), row({ trackHash: 1, station: 'RADIO_TEST_B' })]),
    input([row({ trackHash: '00000000' })]),
    input([row({ trackHash: 'zzzzzzzz' })]),
    input([row({ title: '' })]),
    input([row({ artist: '' })]),
    input([row({ title: 'http://example.test/song' })]),
    input([row({ station: 'radio_test_a' })]),
    input([row({ lyrics: 'nope' })]),
    input([row()], { version: 2 }),
    input([row()], { generatedFrom: 'C:/secret/path' }),
    { version: 1, game: 'gta-v-enhanced', generatedFrom: 'synthetic-fixture', tracks: [], extra: true },
  ];
  const tokens = ['duplicate_track', 'malformed_track_key', 'malformed_track_key', 'blank_title', 'blank_artist', 'unsafe_text', 'malformed_station', 'unexpected_entry_field', 'invalid_version', 'invalid_provenance', 'unexpected_input_field'];
  rejected.forEach((value, index) => {
    const result = buildRadioTrackCatalog(value);
    assert.equal(result.ok, false);
    assert.equal(result.errors.includes(tokens[index]), true);
    assert.equal(result.json, undefined);
  });
  const unordered = JSON.parse(first.json);
  const keys = Object.keys(unordered.tracks);
  unordered.tracks = { [keys[1]]: unordered.tracks[keys[1]], [keys[0]]: unordered.tracks[keys[0]] };
  assert.equal(verifyRadioTrackCatalog(unordered).errors.includes('unordered_tracks'), true);
  assert.equal(verifyRadioTrackCatalogText(first.json.replace('\n', '\n ')).ok, false);
  const tooMany = input(Array.from({ length: RADIO_CATALOG_LIMITS.tracks + 1 }, (_, index) => row({ trackHash: index + 1, title: `Track ${index + 1}` })));
  assert.equal(buildRadioTrackCatalog(tooMany).errors.includes('too_many_tracks'), true);
});

test('production radio catalog stays empty until Rockstar metadata exists', async () => {
  const text = await readFile(productionUrl, 'utf8');
  assert.equal(verifyRadioTrackCatalogText(text).ok, true);
  const parsed = JSON.parse(text);
  assert.equal(parsed.generatedFrom, 'unavailable');
  assert.deepEqual(parsed.tracks, {});
  const catalog = loadRadioTrackCatalog(text);
  assert.equal(catalog.loaded, true);
  assert.equal(catalog.resolve('RADIO_01_CLASS_ROCK', 1).trackKnown, false);
  const empty = buildRadioTrackCatalog({ version: 1, game: 'gta-v-enhanced', generatedFrom: 'unavailable', tracks: [] });
  assert.equal(empty.json, text);
});

test('radio resolution is not imported by prompt, memory, or runtime paths', async () => {
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  for (const file of await walk(root)) {
    if (file.endsWith(`${path.sep}radioTrackCatalog.mjs`)) continue;
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /radioTrackCatalog|resolveRadioTrack|normalizeRadioSignal|Audible environment/);
  }
  for (const file of ['IntelligenceIntegration.cs', 'SensorAdapters.cs']) {
    const source = await readFile(new URL(`../../native/intelligence/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /artist|title|lyrics|prompt|fetch\(|openai/i);
  }
  for (const file of ['buildRadioTrackCatalog.mjs', 'verifyRadioTrackCatalog.mjs']) {
    const source = await readFile(new URL(`../tools/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /fetch\(|https?:\/\//);
  }
});
