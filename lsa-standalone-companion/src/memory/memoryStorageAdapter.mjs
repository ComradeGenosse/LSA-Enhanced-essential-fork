// Standalone host boundary for M1. Production native owner-binding is still pending.
// The shared brain owns all SQLite, timeline, and profile mutation logic.
import { createP2MemoryStorage } from '../../../lsa-shared-brain/src/characters/sqliteProfileStore.mjs';
export function createStandaloneMemoryStorage(options) { return createP2MemoryStorage(options); }
