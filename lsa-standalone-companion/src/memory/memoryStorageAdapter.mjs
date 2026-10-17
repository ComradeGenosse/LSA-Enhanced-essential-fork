// Standalone host boundary for M1. Production native owner-binding is still pending.
// The shared brain owns all SQLite, timeline, and profile mutation logic.
import { createP2MemoryStorage } from '../../../lsa-shared-brain/src/characters/sqliteProfileStore.mjs';
export function createStandaloneMemoryStorage(options) {
  // Fail closed until standalone proves its own native host/epoch source.
  // Storage-only tests may explicitly set sourceRequired:false, never runtime.
  return createP2MemoryStorage({ ...options, sourceRequired:options?.sourceRequired ?? true });
}
