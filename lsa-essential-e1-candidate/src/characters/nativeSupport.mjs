import { IDENTITY_DLL_SHA256 } from '../identity/nativeSupport.mjs';
export const CHARACTER_METADATA_SHA256 = '9ce200bf1a900d996a6f8471a40be1f439d97aa8f86289e334e51e22d627b2e4';
export function characterContractSupported(value) {
  return value?.available === true && value.dllSha256 === IDENTITY_DLL_SHA256 && value.metadataSha256 === CHARACTER_METADATA_SHA256 && value.requiredGameTarget === 'net481' && value.nativeProtocolChanged === false;
}
