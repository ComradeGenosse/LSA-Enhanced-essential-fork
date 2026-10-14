import {resolveMemoryKCapabilities} from './capabilityPolicy.mjs';

// Startup-only gates over B's dependency graph. A request is never a native
// operational receipt. No legacy configuration means the existing PS2/PS3 pair.
export function memoryKSourceActivation(config) {
  const explicit=Object.keys(config.memoryK?.capabilities??{}).length>0;
  const policy=resolveMemoryKCapabilities({config});
  const consumer=id=>{
    const row=policy[id],requestedMode=explicit?row.requestedMode:'shadow';
    const blocked=explicit&&row.state==='blocked';
    return Object.freeze({requestedMode,enabled:requestedMode!=='off'&&!blocked,
      reason:blocked?'dependency_blocked':requestedMode==='off'?'optional_consumer_stopped':null});
  };
  return Object.freeze({explicit,ps2:consumer('ps2.observations'),ps3:consumer('ps3.salience')});
}
