import { IDENTITY_DLL_SHA256 } from '../identity/nativeSupport.mjs';
// UX phase 1 player-control seams. The metadata file is generated from the
// pinned Essential DLL with `tools/native-metadata --controls`; drift fails closed.
export const CONTROLS_METADATA_SHA256 = '9484b30448c1786e7b02d16147ddaaaab3cea9eda120affbd019fc422f4f31f4';
export function controlsContractSupported(value) {
  return value?.available === true && value.version === 1 && value.dllSha256 === IDENTITY_DLL_SHA256 &&
    value.metadataSha256 === CONTROLS_METADATA_SHA256 && value.requiredGameTarget === 'net481' && value.nativeProtocolChanged === false;
}
// UX phases 2-3 plus ACT2. contracts/commands.v2.json is embedded into the loader, and
// native/enhanced/Commands/CommandCatalog.cs pins the same SHA-256.
export const COMMANDS_CONTRACT_SHA256 = '07e0ad837bcbce8b6ff088a0b57ae6aad94e23cdbb5ac4a6bc4668a20b15d754';
// Compile-only RAGENativeUI reference (NuGet RAGENativeUI 1.9.3, lib/net472). It is
// never packaged; the loader requires assembly version 1.9.3.0 at runtime.
export const RNUI_DLL_SHA256 = 'd2607481b206e7907c9c1f2cabf15797654aacaaf1746ea202740dcdd5eb8bbb';
export const RNUI_ASSEMBLY_VERSION = '1.9.3.0';
