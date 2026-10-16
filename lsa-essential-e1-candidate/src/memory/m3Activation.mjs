import {resolveMemoryKCapabilities} from './capabilityPolicy.mjs';
import {memoryKConsumersAllowed} from './runtimeComposition.mjs';

// Startup-only G controls. Dependencies describe source qualification, never
// conversation recording, notability, recall or background processing.
export function memoryKM3Activation(config) {
  const explicit=!memoryKConsumersAllowed(config);
  const policy=resolveMemoryKCapabilities({config});
  const gate=id=>{
    const row=policy[id],requestedMode=explicit?row.requestedMode:'on';
    const reason=explicit&&row.state==='blocked'?'dependency_blocked':
      requestedMode==='off'?'optional_consumer_stopped':null;
    return Object.freeze({requestedMode,mode:reason?'off':requestedMode,reason,
      missingDependencies:row.missingDependencies});
  };
  return Object.freeze({explicit,events:gate('memory.events'),coverage:gate('memory.coverage')});
}

// For startup failures and configurations which acquire no M3 resources.
export function unavailableM3States(activation,reason='m3_production_ports_unavailable') {
  return Object.freeze(Object.fromEntries(['events','coverage'].map(kind=>{
    const gate=activation[kind],off=gate.requestedMode==='off';
    return ['memory.'+kind,Object.freeze({requestedMode:gate.requestedMode,
      effectiveMode:'off',state:off?'stopped':'blocked',operationalState:off?'stopped':'blocked',
      sourceReady:false,dependencyReady:false,reason:gate.reason??reason,
      missingDependencies:gate.missingDependencies,
      counters:Object.freeze({}),restartRequired:true})];
  })));
}
