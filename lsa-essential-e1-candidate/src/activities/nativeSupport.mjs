export { ACTIVITY_CAPABILITIES_SHA256 } from './capabilityRegistry.mjs';

export function activityPipePath(pipeName = 'LSA.Activities.v1') {
  return `\\\\.\\pipe\\${pipeName}`;
}
