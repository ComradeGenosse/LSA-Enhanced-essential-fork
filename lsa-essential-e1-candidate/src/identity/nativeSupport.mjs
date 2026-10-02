export const IDENTITY_METADATA_SHA256 = '8eac8860c81feacbb5eab557f5769cac1f76a36f061e1eb3640da7096f08cb63';
export const IDENTITY_DLL_SHA256 = '9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653';
export function identityContractSupported(contract) {
  return contract?.available === true && contract.requiredGameTarget === 'net481' &&
    contract.dllSha256 === IDENTITY_DLL_SHA256 && contract.metadataSha256 === IDENTITY_METADATA_SHA256 && contract.nativeProtocolChanged === false;
}
