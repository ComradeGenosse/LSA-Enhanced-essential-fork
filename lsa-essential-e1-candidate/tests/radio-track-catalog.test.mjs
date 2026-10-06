import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  RadioTrackTextCatalog, loadRadioTrackTextCatalog, normalizeRadioSignal, resolveRadioTrack,
  serializeRadioTrackTextCatalog, verifyRadioTrackTextCatalog, verifyRadioTrackTextCatalogText,
} from '../src/perception/radioTrackCatalog.mjs';

const productionUrl = new URL('../data/radioTrackTextIds.v2.json', import.meta.url);

function fixture() {
  return {
    version:2,game:'gta-v-enhanced',key:'trackTextId',
    generatedFrom:{
      trackMetadata:{repository:'Example/radio-dump',commit:'1111111111111111111111111111111111111111'},
      stationLabels:{repository:'Example/stations',commit:'2222222222222222222222222222222222222222'},
    },
    counts:{entries:4,music:2,commercial:1,off:1,stations:3},
    stations:{
      RADIO_TEST_A:{name:'Test Radio A'},
      RADIO_TEST_B:{name:'Test Radio B'},
      RADIO_TEST_C:{name:'Test Radio C'},
    },
    tracks:{
      '1004':{title:'Hollywood Nights',artist:'BOB SEGER',kind:'music',stations:['RADIO_TEST_A']},
      '1005':{title:'One Girl/One Boy',artist:'!!! / TEST ARTIST',kind:'music',stations:['RADIO_TEST_A','RADIO_TEST_B']},
      '2000':{title:'Commercial Break',artist:'Commercial',kind:'commercial',stations:['RADIO_TEST_A','RADIO_TEST_C']},
      '2095':{title:'Off',artist:'Media Player',kind:'off',stations:['RADIO_TEST_C']},
    },
  };
}

test('v2 catalog validates, allows legitimate slashes, and resolves by text ID rather than sound hash',()=>{
  const raw=fixture(),text=serializeRadioTrackTextCatalog(raw);
  assert.equal(verifyRadioTrackTextCatalog(raw).ok,true);
  assert.equal(verifyRadioTrackTextCatalogText(text).ok,true);
  const catalog=loadRadioTrackTextCatalog(text);
  assert.equal(catalog.loaded,true);

  const known=catalog.resolve({station:'RADIO_TEST_A',soundHash:0x93e4a82b,trackTextId:1004});
  assert.deepEqual(known,{station:'RADIO_TEST_A',soundHash:0x93e4a82b,trackTextId:1004,trackKnown:true,stationName:'Test Radio A',kind:'music',artist:'BOB SEGER',title:'Hollywood Nights'});

  const sameContainerNewSong=catalog.resolve({station:'RADIO_TEST_A',soundHash:0x93e4a82b,trackTextId:1005});
  assert.equal(sameContainerNewSong.title,'One Girl/One Boy');
  assert.equal(sameContainerNewSong.artist,'!!! / TEST ARTIST');
  assert.notEqual(sameContainerNewSong.title,known.title);

  const differentContainerSameSong=catalog.resolve({station:'RADIO_TEST_A',soundHash:1,trackTextId:1004});
  assert.equal(differentContainerSameSong.title,'Hollywood Nights');
  assert.equal(resolveRadioTrack({station:'RADIO_TEST_A',soundHash:2,trackTextId:1004},catalog).title,'Hollywood Nights');
});

test('v2 resolver fails closed for unknown IDs and wrong station while preserving station display metadata',()=>{
  const catalog=loadRadioTrackTextCatalog(serializeRadioTrackTextCatalog(fixture()));
  const unknown=catalog.resolve({station:'RADIO_TEST_A',soundHash:7,trackTextId:999999});
  assert.equal(unknown.trackKnown,false);assert.equal(unknown.stationName,'Test Radio A');assert.equal('artist' in unknown,false);
  assert.equal(catalog.unknownTextIds,1);

  const mismatch=catalog.resolve({station:'RADIO_TEST_C',soundHash:7,trackTextId:1004});
  assert.equal(mismatch.trackKnown,false);assert.equal(mismatch.catalogMismatch,true);assert.equal('title' in mismatch,false);
  assert.equal(catalog.catalogMismatches,1);

  for(const textId of [0,-1,-2147483648]) {
    const unresolved=catalog.resolve({station:'RADIO_TEST_A',soundHash:7,trackTextId:textId});
    assert.equal(unresolved.trackKnown,false);
  }
  assert.equal(catalog.unknownTextIds,1,'nonpositive runtime semantics remain unknown without inflating unmapped-positive counter');
});

test('v2 resolver preserves multi-station content kinds including commercials and off marker',()=>{
  const catalog=loadRadioTrackTextCatalog(serializeRadioTrackTextCatalog(fixture()));
  for(const station of ['RADIO_TEST_A','RADIO_TEST_B']) {
    const shared=catalog.resolve({station,soundHash:1,trackTextId:1005});
    assert.equal(shared.trackKnown,true);assert.equal(shared.kind,'music');
  }
  const commercial=catalog.resolve({station:'RADIO_TEST_C',soundHash:5,trackTextId:2000});
  assert.equal(commercial.trackKnown,true);assert.equal(commercial.kind,'commercial');
  const off=catalog.resolve({station:'RADIO_TEST_C',soundHash:5,trackTextId:2095});
  assert.equal(off.trackKnown,true);assert.equal(off.kind,'off');
});

test('v2 catalog rejects malformed schema, unsafe display text, bad provenance, and count drift',()=>{
  const cases=[
    [{...fixture(),version:1},'invalid_version'],
    [{...fixture(),key:'soundHash'},'invalid_key'],
    [{...fixture(),generatedFrom:{...fixture().generatedFrom,trackMetadata:{repository:'bad',commit:'x'}}},'invalid_provenance'],
    [{...fixture(),counts:{...fixture().counts,entries:5}},'count_mismatch'],
    [{...fixture(),tracks:{...fixture().tracks,'1006':{title:'Bad\nTitle',artist:'A',kind:'music',stations:['RADIO_TEST_A']}}},'invalid_track'],
    [{...fixture(),tracks:{...fixture().tracks,'1006':{title:'X',artist:'A',kind:'music',stations:['RADIO_UNKNOWN']}}},'invalid_track_station'],
  ];
  for(const [value,token] of cases) assert.equal(verifyRadioTrackTextCatalog(value).errors.includes(token),true,token);
});

test('radio normalization carries text ID semantics without leaking title/artist on raw input',()=>{
  const catalog=loadRadioTrackTextCatalog(serializeRadioTrackTextCatalog(fixture()));
  const signal={signalId:'00000000-0000-4000-8000-000000000001',producer:'radio',kind:'radio_changed',source:null,target:'00000000-0000-4000-8000-000000000002',gameTick:4,facts:{station:'RADIO_TEST_A',soundHash:123,trackTextId:1004}};
  const normalized=normalizeRadioSignal(signal,catalog);
  assert.equal(normalized.kind,'radio_audio');assert.equal(normalized.contentKind,'music');assert.equal(normalized.trackTextId,1004);
  assert.equal(normalized.soundHash,123);assert.equal(normalized.artist,'BOB SEGER');assert.equal(normalized.title,'Hollywood Nights');
  assert.deepEqual(signal.facts,{station:'RADIO_TEST_A',soundHash:123,trackTextId:1004});

  const unknown=normalizeRadioSignal({...signal,facts:{station:'RADIO_TEST_A',soundHash:123,trackTextId:999999}},catalog);
  assert.equal(unknown.trackKnown,false);assert.equal('contentKind' in unknown,false);assert.equal('artist' in unknown,false);

  const stopped=normalizeRadioSignal({...signal,kind:'radio_stopped',facts:{station:'',soundHash:0,trackTextId:0}},catalog);
  assert.equal(stopped.trackKnown,false);assert.equal(stopped.soundHash,0);assert.equal(stopped.trackTextId,0);
});

test('researched production v2 catalog is canonical and contains the audited mapping/counts',async()=>{
  const text=await readFile(productionUrl,'utf8');
  assert.equal(verifyRadioTrackTextCatalogText(text).ok,true);
  const parsed=JSON.parse(text);
  assert.deepEqual(parsed.counts,{entries:1058,music:951,commercial:106,off:1,stations:26});
  assert.deepEqual(parsed.tracks['1004'],{title:'Hollywood Nights',artist:'BOB SEGER',kind:'music',stations:['RADIO_01_CLASS_ROCK']});
  assert.equal(parsed.tracks['2095'].kind,'off');
  const catalog=loadRadioTrackTextCatalog(text);
  assert.equal(catalog.resolve({station:'RADIO_01_CLASS_ROCK',soundHash:1,trackTextId:1004}).title,'Hollywood Nights');
});

test('catalog runtime and conversion paths make no network requests',async()=>{
  const runtime=await readFile(new URL('../src/perception/radioTrackCatalog.mjs',import.meta.url),'utf8');
  const converter=await readFile(new URL('../tools/buildRadioTrackTextCatalog.mjs',import.meta.url),'utf8');
  const verifier=await readFile(new URL('../tools/verifyRadioTrackTextCatalog.mjs',import.meta.url),'utf8');
  for(const source of [runtime,converter,verifier]) assert.doesNotMatch(source,/\bfetch\s*\(|https?:\/\//);
  const unavailable=RadioTrackTextCatalog.unavailable();
  assert.equal(unavailable.resolve({station:'RADIO_TEST_A',soundHash:1,trackTextId:1004}).trackKnown,false);
});
