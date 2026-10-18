// Essential host boundary for M1. This is OPT-IN and is not wired to the live P2 service.
// The shared brain owns all SQLite, timeline, and profile mutation logic.
import { createP2MemoryStorage } from '../../../lsa-shared-brain/src/characters/sqliteProfileStore.mjs';
export function createEssentialMemoryStorage(options) { return createP2MemoryStorage(options); }
