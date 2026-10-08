import {isUuid} from '../identity/identityContract.mjs';
export function readPrimaryBehaviorOwner(value){
 if(!value || typeof value!=='object' || Array.isArray(value) || !['owner','mode','since'].every(key=>Object.hasOwn(value,key)) || Object.keys(value).some(key=>!['owner','mode','since','leaseId'].includes(key)))return null;
 if(!['p2','act','essential_residual','none'].includes(value.owner) || !['follow','wait','sit','activity','unknown','idle'].includes(value.mode) || !Number.isSafeInteger(value.since) || value.since<0 || value.since>0xffffffff || value.leaseId!==undefined && !isUuid(value.leaseId))return null;
 return Object.freeze({...value});
}
