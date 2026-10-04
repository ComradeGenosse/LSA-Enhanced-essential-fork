import { IDENTITY_DLL_SHA256 } from '../identity/nativeSupport.mjs';
// UX phase 1 player-control seams. The metadata file is generated from the
// pinned Essential DLL with `tools/native-metadata --controls`; drift fails closed.
export const CONTROLS_METADATA_SHA256 = '9484b30448c1786e7b02d16147ddaaaab3cea9eda120affbd019fc422f4f31f4';
export function controlsContractSupported(value) {
  return value?.available === true && value.version === 1 && value.dllSha256 === IDENTITY_DLL_SHA256 &&
    value.metadataSha256 === CONTROLS_METADATA_SHA256 && value.requiredGameTarget === 'net481' && value.nativeProtocolChanged === false;
}
