// Compatibility-only import surface. The active radio catalog is v2 and keyed by
// GTA trackTextId; no hash-keyed artist/title resolver exists on this branch.
export {
  RADIO_TEXT_CATALOG_LIMITS,
  RadioTrackTextCatalog,
  RadioTrackTextCatalog as RadioTrackCatalog,
  loadRadioTrackTextCatalog,
  loadRadioTrackTextCatalog as loadRadioTrackCatalog,
  normalizeRadioSignal,
  resolveRadioTrack,
  serializeRadioTrackTextCatalog,
  verifyRadioTrackTextCatalog,
  verifyRadioTrackTextCatalogText,
} from './radioTrackTextCatalog.mjs';
