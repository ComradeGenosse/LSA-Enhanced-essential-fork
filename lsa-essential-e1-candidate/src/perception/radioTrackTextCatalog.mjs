export const RADIO_TEXT_CATALOG_LIMITS = Object.freeze({
  tracks: 4096,
  stations: 128,
  bytes: 1024 * 1024,
  stationName: 80,
  artist: 120,
  title: 160,
});

const STATION = /^[A-Z0-9_]{1,64}$/;
const DECIMAL_ID = /^[1-9][0-9]{0,9}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COMMIT = /^[0-9a-f]{40}$/;
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;
const UINT32_MAX = 0xffffffff;
const KINDS = new Set(['music','commercial','off']);
const saturate = value => Math.min(2147483647, value + 1);

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactKeys(value, required) {
  return object(value) && Object.keys(value).length === required.length &&
    required.every(key => Object.hasOwn(value,key));
}
function wellFormed(value) {
  if (typeof value !== 'string' || value.length < 1) return false;
  for (let i=0;i<value.length;i++) {
    const code=value.charCodeAt(i);
    if(code>=0xd800&&code<=0xdbff) {
      const next=value.charCodeAt(++i);
      if(!(next>=0xdc00&&next<=0xdfff)) return false;
    } else if(code>=0xdc00&&code<=0xdfff) return false;
  }
  return true;
}
function safeDisplay(value,max) {
  return wellFormed(value) && value.length<=max && !/[\u0000-\u001f\u007f]/u.test(value) && !value.includes('://');
}
function stationLabel(catalog,station) {
  const name=catalog?.stations?.[station]?.name;
  return safeDisplay(name,RADIO_TEXT_CATALOG_LIMITS.stationName) ? name : undefined;
}
function validSoundHash(value) { return Number.isSafeInteger(value) && value>=0 && value<=UINT32_MAX; }
function validTrackTextId(value) { return Number.isSafeInteger(value) && value>=INT32_MIN && value<=INT32_MAX; }
function provenance(value) {
  return exactKeys(value,['repository','commit']) && REPOSITORY.test(value.repository) && COMMIT.test(value.commit);
}

export function verifyRadioTrackTextCatalog(value) {
  const errors=[];
  const push=token=>{if(errors.length<32&&!errors.includes(token)) errors.push(token);};
  if(!exactKeys(value,['version','game','key','generatedFrom','counts','stations','tracks'])) return {ok:false,errors:['unexpected_catalog_field']};
  if(value.version!==2) push('invalid_version');
  if(value.game!=='gta-v-enhanced') push('invalid_game');
  if(value.key!=='trackTextId') push('invalid_key');
  if(!exactKeys(value.generatedFrom,['trackMetadata','stationLabels']) ||
     !provenance(value.generatedFrom.trackMetadata) || !provenance(value.generatedFrom.stationLabels)) push('invalid_provenance');
  if(!exactKeys(value.counts,['entries','music','commercial','off','stations']) ||
     !Object.values(value.counts).every(n=>Number.isSafeInteger(n)&&n>=0)) push('invalid_counts');
  if(!object(value.stations)) push('invalid_stations');
  if(!object(value.tracks)) push('invalid_tracks');
  if(errors.length) return {ok:false,errors};

  const stationKeys=Object.keys(value.stations);
  if(stationKeys.length>RADIO_TEXT_CATALOG_LIMITS.stations) push('too_many_stations');
  for(const station of stationKeys) {
    const row=value.stations[station];
    if(!STATION.test(station) || !exactKeys(row,['name']) || !safeDisplay(row.name,RADIO_TEXT_CATALOG_LIMITS.stationName)) push('invalid_station');
  }

  const trackKeys=Object.keys(value.tracks);
  if(trackKeys.length>RADIO_TEXT_CATALOG_LIMITS.tracks) push('too_many_tracks');
  let music=0,commercial=0,off=0;
  for(const key of trackKeys) {
    const row=value.tracks[key];
    if(!DECIMAL_ID.test(key) || Number(key)>INT32_MAX) {push('invalid_track_text_id');continue;}
    if(!exactKeys(row,['title','artist','kind','stations']) || !safeDisplay(row.title,RADIO_TEXT_CATALOG_LIMITS.title) ||
       !safeDisplay(row.artist,RADIO_TEXT_CATALOG_LIMITS.artist) || !KINDS.has(row.kind) ||
       !Array.isArray(row.stations) || row.stations.length<1 || row.stations.length>32) {push('invalid_track');continue;}
    if(new Set(row.stations).size!==row.stations.length || row.stations.some(station=>!STATION.test(station)||!Object.hasOwn(value.stations,station))) push('invalid_track_station');
    if(row.kind==='music') music++; else if(row.kind==='commercial') commercial++; else off++;
  }
  if(value.counts.entries!==trackKeys.length || value.counts.music!==music || value.counts.commercial!==commercial ||
     value.counts.off!==off || value.counts.stations!==stationKeys.length) push('count_mismatch');
  if(errors.length===0 && Buffer.byteLength(serializeRadioTrackTextCatalog(value),'utf8')>RADIO_TEXT_CATALOG_LIMITS.bytes) push('catalog_too_large');
  return {ok:errors.length===0,errors};
}

export function serializeRadioTrackTextCatalog(value) {
  const stations={};
  for(const key of Object.keys(value.stations||{}).sort()) stations[key]={name:value.stations[key].name};
  const tracks={};
  for(const key of Object.keys(value.tracks||{}).sort((a,b)=>Number(a)-Number(b))) {
    const row=value.tracks[key];
    tracks[key]={title:row.title,artist:row.artist,kind:row.kind,stations:[...row.stations].sort()};
  }
  return JSON.stringify({
    version:2,game:'gta-v-enhanced',key:'trackTextId',
    generatedFrom:{
      trackMetadata:{repository:value.generatedFrom.trackMetadata.repository,commit:value.generatedFrom.trackMetadata.commit},
      stationLabels:{repository:value.generatedFrom.stationLabels.repository,commit:value.generatedFrom.stationLabels.commit},
    },
    counts:{entries:value.counts.entries,music:value.counts.music,commercial:value.counts.commercial,off:value.counts.off,stations:value.counts.stations},
    stations,tracks,
  },null,2)+'\n';
}

export function verifyRadioTrackTextCatalogText(text) {
  if(typeof text!=='string'||text.length===0||Buffer.byteLength(text,'utf8')>RADIO_TEXT_CATALOG_LIMITS.bytes||text.charCodeAt(0)===0xfeff) return {ok:false,errors:['invalid_catalog_text']};
  let value;try{value=JSON.parse(text);}catch{return {ok:false,errors:['invalid_catalog_text']};}
  const verified=verifyRadioTrackTextCatalog(value);
  if(!verified.ok) return verified;
  if(text!==serializeRadioTrackTextCatalog(value)) return {ok:false,errors:['not_canonical']};
  return {ok:true,errors:[]};
}

export class RadioTrackTextCatalog {
  constructor(raw,loaded=false) {
    this.loaded=loaded===true;this.version=2;this.game='gta-v-enhanced';
    this.stations=raw?.stations&&object(raw.stations)?raw.stations:Object.freeze({});
    this.tracks=raw?.tracks&&object(raw.tracks)?raw.tracks:Object.freeze({});
    this.unknownTextIds=0;this.catalogMismatches=0;
  }
  static unavailable() { return new RadioTrackTextCatalog({stations:{},tracks:{}},false); }
  resolve({station,soundHash,trackTextId}={}) {
    const safeStation=typeof station==='string'&&STATION.test(station)?station:'';
    const safeSound=validSoundHash(soundHash)?soundHash:0;
    const safeText=validTrackTextId(trackTextId)?trackTextId:0;
    const base={station:safeStation,soundHash:safeSound,trackTextId:safeText,trackKnown:false};
    const name=stationLabel(this,safeStation);if(name) base.stationName=name;
    if(safeText<=0) return Object.freeze(base);
    const entry=this.tracks[String(safeText)];
    if(!entry) {this.unknownTextIds=saturate(this.unknownTextIds);return Object.freeze(base);}
    if(!entry.stations.includes(safeStation)) {
      this.catalogMismatches=saturate(this.catalogMismatches);
      return Object.freeze({...base,catalogMismatch:true});
    }
    return Object.freeze({...base,trackKnown:true,kind:entry.kind,artist:entry.artist,title:entry.title});
  }
}

export function loadRadioTrackTextCatalog(text) {
  const verified=verifyRadioTrackTextCatalogText(text);
  if(!verified.ok) return RadioTrackTextCatalog.unavailable();
  const raw=JSON.parse(text);
  const stations={};for(const [key,row] of Object.entries(raw.stations)) stations[key]=Object.freeze({name:row.name});
  const tracks={};for(const [key,row] of Object.entries(raw.tracks)) tracks[key]=Object.freeze({title:row.title,artist:row.artist,kind:row.kind,stations:Object.freeze([...row.stations])});
  return new RadioTrackTextCatalog({stations:Object.freeze(stations),tracks:Object.freeze(tracks)},true);
}

export function resolveRadioTrack(input,catalog) {
  return (catalog??RadioTrackTextCatalog.unavailable()).resolve(input);
}

export function normalizeRadioSignal(signal,catalog) {
  if(!signal||signal.producer!=='radio'||signal.source!==null||!signal.facts) return null;
  const sourceVehicleCaptureRef=signal.target??null;
  if(signal.kind==='radio_stopped') {
    if(signal.facts.station!==''||signal.facts.soundHash!==0||signal.facts.trackTextId!==0) return null;
    return Object.freeze({eventSignalId:signal.signalId,kind:'radio_audio',soundKind:'radio',gameTick:signal.gameTick,sourceVehicleCaptureRef,station:'',soundHash:0,trackTextId:0,trackKnown:false});
  }
  if(signal.kind!=='radio_changed') return null;
  const resolved=(catalog??RadioTrackTextCatalog.unavailable()).resolve(signal.facts);
  const {kind:contentKind,...base}=resolved;
  return Object.freeze({eventSignalId:signal.signalId,kind:'radio_audio',soundKind:'radio',gameTick:signal.gameTick,sourceVehicleCaptureRef,...base,...(contentKind?{contentKind}:{})});
}

