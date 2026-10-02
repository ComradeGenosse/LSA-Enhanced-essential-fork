import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { IDENTITY_METADATA_SHA256, IDENTITY_DLL_SHA256 } from '../src/identity/nativeSupport.mjs';
export { IDENTITY_METADATA_SHA256, IDENTITY_DLL_SHA256 };

export const RPH_SDK_SHA256 = '5d439745604a5fedbf8fa401520d4f296c1b6800d77e2923ba3bf9772182c7e0';
export function validateIdentityEvidence(evidence, dllHash) {
  if (dllHash !== IDENTITY_DLL_SHA256 || evidence.dllSha256 !== dllHash) throw new Error('identity_dll_mismatch');
  const type = name => {
    const found = evidence.types.filter(type => type.name === name);
    if (found.length !== 1) throw new Error('identity_type_mismatch');
    return found[0];
  };
  const method = (typeName, name, returns, parameters) => {
    const found = type(typeName).methods.filter(method => method.name === name && method.returns === returns && JSON.stringify(method.parameters) === JSON.stringify(parameters));
    if (found.length !== 1) throw new Error('identity_signature_mismatch');
  };
  const integration = 'LosSantosAlive.Integrations.IIntegration';
  for (const name of ['Initialize','Update','Shutdown']) method(integration,name,'Void',[]);
  method(integration,'get_Id','String',[]); method(integration,'get_IsAvailable','Boolean',[]);
  method(integration,'EnrichActor','Void',['Rage.Ped','LosSantosAlive.Context.ActorContext']);
  method(integration,'OnPedControlChanged','Void',['Rage.Ped','Boolean']);
  method(integration,'OnNpcActionExecuted','Void',['Rage.Ped','String','Boolean']);
  method('LosSantosAlive.Integrations.IntegrationManager','Register','Void',[integration]);
  method('LosSantosAlive.Integrations.IntegrationJsonBlock','.ctor','Void',['String','String']);
  for (const [name, typeName] of [['PedId','String'],['IntegrationBlocks','System.Collections.Generic.List`1<LosSantosAlive.Integrations.IntegrationJsonBlock>']]) {
    if (type('LosSantosAlive.Context.ActorContext').fields.filter(field => field.name === name && field.type === typeName).length !== 1) throw new Error('identity_field_mismatch');
  }
  return { available: true, dllSha256: dllHash, metadataSha256: IDENTITY_METADATA_SHA256, requiredGameTarget: 'net481', nativeProtocolChanged: false };
}
export async function verifyIdentityContract(dllHash = IDENTITY_DLL_SHA256, metadataText) {
  try {
    const bytes = metadataText ?? await readFile(new URL('../docs/session-identity-native-metadata.json', import.meta.url));
    if (createHash('sha256').update(bytes).digest('hex') !== IDENTITY_METADATA_SHA256) throw new Error('identity_metadata_mismatch');
    return validateIdentityEvidence(JSON.parse(String(bytes)), dllHash);
  } catch { return { available: false, reason: 'optional_identity_contract_unavailable', nativeProtocolChanged: false }; }
}
