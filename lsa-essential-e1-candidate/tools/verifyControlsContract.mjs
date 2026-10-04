import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { IDENTITY_DLL_SHA256 } from '../src/identity/nativeSupport.mjs';
import { CONTROLS_METADATA_SHA256 } from '../src/control/nativeSupport.mjs';

// Pins the exact Essential seams used by the UX phase 1 command bridge:
// the stock typed-turn entry and the two input gates. Nothing else is claimed.
export async function verifyControlsContract(dllHash = IDENTITY_DLL_SHA256, metadataText) {
  try {
    const bytes = metadataText ?? await readFile(new URL('../docs/controls-native-metadata.json', import.meta.url));
    if (dllHash !== IDENTITY_DLL_SHA256 || createHash('sha256').update(bytes).digest('hex') !== CONTROLS_METADATA_SHA256) throw new Error('controls_metadata_mismatch');
    const data = JSON.parse(String(bytes));
    if (data.dllSha256 !== dllHash) throw new Error('controls_dll_mismatch');
    const method = (typeName, name, returns, parameters) => {
      const matches = data.types.filter(type => type.name === typeName);
      if (matches.length !== 1 || matches[0].methods.filter(item => item.name === name && item.returns === returns && JSON.stringify(item.parameters) === JSON.stringify(parameters)).length !== 1) throw new Error('controls_signature_mismatch');
    };
    method('LosSantosAlive.Input.InputController', 'SendTextPrompt', 'Void', ['Rage.Ped', 'String']);
    method('LosSantosAlive.Input.TextInputService', 'get_IsOpen', 'Boolean', []);
    method('LosSantosAlive.Core.LsaControlsMenu', 'get_BlocksLsaInput', 'Boolean', []);
    method('LosSantosAlive.NPC.NpcTargeting', 'IsValidHumanPed', 'Boolean', ['Rage.Ped']);
    return { available: true, version: 1, dllSha256: dllHash, metadataSha256: CONTROLS_METADATA_SHA256, requiredGameTarget: 'net481', nativeProtocolChanged: false };
  } catch { return { available: false, reason: 'optional_controls_contract_unavailable', nativeProtocolChanged: false }; }
}
