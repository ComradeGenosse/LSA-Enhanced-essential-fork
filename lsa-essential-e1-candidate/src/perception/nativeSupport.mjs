import { IDENTITY_DLL_SHA256 } from '../identity/nativeSupport.mjs';
export const DAMAGE_DLL_SHA256='64816a0d1131a6ec241f8951902b08afaee86fb0f73693399edefe2db8776750';
export const PERCEPTION_METADATA_SHA256='d746155f707158bf97ee75452da0be04d258b2142fd0c6bdcb9cc014e36bbfb3';
export const DAMAGE_METADATA_SHA256='a78c6bcb866605f88b281a56dfe26fd3b508bc5c15a317383aefbec146b547a9';
export function perceptionContractSupported(c) {return c?.available===true && c.version===1 && c.dllSha256===IDENTITY_DLL_SHA256 && c.damageDllSha256===DAMAGE_DLL_SHA256 && c.metadataSha256===PERCEPTION_METADATA_SHA256 && c.damageMetadataSha256===DAMAGE_METADATA_SHA256;}
