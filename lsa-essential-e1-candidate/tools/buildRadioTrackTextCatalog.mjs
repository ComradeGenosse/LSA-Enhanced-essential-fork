import { readFile, writeFile } from 'node:fs/promises';

const STATION = /^[A-Z0-9_]{1,64}$/;
const SAFE_TEXT_MAX = Object.freeze({ stationName: 80, artist: 120, title: 160 });
const DEFAULT_HINT_COMMIT = 'd85fa6d9a63a2bc0d75109a6a8a3f9f26228e0cc';
const DEFAULT_DURTY_COMMIT = 'b65684e00f689fdec405c5f1055322c802d3c895';

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function wellFormed(value) {
  if (typeof value !== 'string' || value.length < 1) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function safeDisplay(value, max) {
  if (!wellFormed(value) || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  return true;
}

function stationNameMap(rows) {
  if (!Array.isArray(rows)) throw new Error('DurtyFree radioStations input must be an array.');
  const map = new Map();
  for (const row of rows) {
    if (!object(row) || typeof row.RadioName !== 'string') continue;
    const key = row.RadioName.toLowerCase();
    const label = row.TranslatedLabel?.English || row.RadioName;
    if (!safeDisplay(label, SAFE_TEXT_MAX.stationName)) throw new Error('Unsafe station label for ' + row.RadioName);
    map.set(key, label);
  }
  return map;
}

export function buildRadioTrackTextCatalog(hint, durty, {
  hintCommit = DEFAULT_HINT_COMMIT,
  durtyCommit = DEFAULT_DURTY_COMMIT,
} = {}) {
  if (!object(hint?.Stations) || !object(hint?.TrackLists)) throw new Error('HintSystem input is not a merged radio dump.');

  const labels = stationNameMap(durty);
  const owners = new Map();

  for (const [stationKey, station] of Object.entries(hint.Stations)) {
    if (!object(station)) continue;
    const radioName = typeof station.RadioName === 'string' && station.RadioName.length ? station.RadioName : stationKey.toUpperCase();
    if (!STATION.test(radioName)) throw new Error('Invalid radio station key: ' + radioName);
    for (const listName of station.TrackLists || []) {
      if (typeof listName !== 'string' || !listName.length) continue;
      if (!owners.has(listName)) owners.set(listName, new Set());
      owners.get(listName).add(radioName);
    }
  }

  const byId = new Map();
  for (const [listName, list] of Object.entries(hint.TrackLists)) {
    if (!object(list)) continue;
    const category = String(list.Category ?? '');
    const stationSet = owners.get(listName) || new Set();

    for (const container of Array.isArray(list.Tracks) ? list.Tracks : []) {
      const markers = Array.isArray(container?.Markers?.Track) ? container.Markers.Track : [];
      for (const marker of markers) {
        if (!Number.isSafeInteger(marker?.Id) || marker.Id <= 0) throw new Error('Invalid track text ID.');
        const title = String(marker.Title ?? '');
        const artist = String(marker.Artist ?? '');
        if (!safeDisplay(title, SAFE_TEXT_MAX.title)) throw new Error('Unsafe title at text ID ' + marker.Id);
        if (!safeDisplay(artist, SAFE_TEXT_MAX.artist)) throw new Error('Unsafe artist at text ID ' + marker.Id);

        if (!byId.has(marker.Id)) {
          byId.set(marker.Id, {
            title,
            artist,
            categories: new Set(),
            stations: new Set(),
          });
        }

        const entry = byId.get(marker.Id);
        if (entry.title !== title || entry.artist !== artist) {
          throw new Error('Conflicting title/artist for track text ID ' + marker.Id);
        }
        entry.categories.add(category);
        for (const station of stationSet) entry.stations.add(station);
      }
    }
  }

  const tracks = {};
  const stationKeys = new Set();
  const counts = { entries: byId.size, music: 0, commercial: 0, off: 0, stations: 0 };

  for (const id of [...byId.keys()].sort((a, b) => a - b)) {
    const entry = byId.get(id);
    const categories = [...entry.categories];
    let kind;
    if (id === 2095 && entry.title === 'Off' && entry.artist === 'Media Player') {
      kind = 'off';
      counts.off++;
    } else if (entry.artist === 'Commercial' || categories.includes('0')) {
      kind = 'commercial';
      counts.commercial++;
    } else {
      kind = 'music';
      counts.music++;
    }

    const stations = [...entry.stations].sort();
    for (const station of stations) stationKeys.add(station);
    tracks[String(id)] = Object.freeze({
      title: entry.title,
      artist: entry.artist,
      kind,
      stations,
    });
  }

  const stations = {};
  for (const key of [...stationKeys].sort()) {
    stations[key] = { name: labels.get(key.toLowerCase()) || key };
  }
  counts.stations = stationKeys.size;

  return {
    version: 2,
    game: 'gta-v-enhanced',
    key: 'trackTextId',
    generatedFrom: {
      trackMetadata: {
        repository: 'HintSystem/GTA-V-Radio-Dumps',
        commit: hintCommit,
      },
      stationLabels: {
        repository: 'DurtyFree/gta-v-data-dumps',
        commit: durtyCommit,
      },
    },
    counts,
    stations,
    tracks,
  };
}

export function serializeRadioTrackTextCatalog(catalog) {
  return JSON.stringify(catalog, null, 2) + '\n';
}

async function main() {
  const [hintPath, durtyPath, outputPath, hintCommit = DEFAULT_HINT_COMMIT, durtyCommit = DEFAULT_DURTY_COMMIT] = process.argv.slice(2);
  if (!hintPath || !durtyPath || !outputPath) {
    console.error('Usage: node tools/buildRadioTrackTextCatalog.mjs <HintSystem-info_merged.json> <DurtyFree-radioStations.json> <output.json> [hintCommit] [durtyCommit]');
    process.exitCode = 1;
    return;
  }
  const hint = JSON.parse(await readFile(hintPath, 'utf8'));
  const durty = JSON.parse(await readFile(durtyPath, 'utf8'));
  const catalog = buildRadioTrackTextCatalog(hint, durty, { hintCommit, durtyCommit });
  await writeFile(outputPath, serializeRadioTrackTextCatalog(catalog), 'utf8');
  console.log(JSON.stringify(catalog.counts));
}

if (process.argv[1]?.endsWith('buildRadioTrackTextCatalog.mjs')) await main();
