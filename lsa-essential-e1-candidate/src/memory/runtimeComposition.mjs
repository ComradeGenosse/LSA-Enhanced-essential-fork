import {MEMORY_K_CAPABILITIES,resolveMemoryKCapabilities} from './capabilityPolicy.mjs';

// Instance-owned resource composition, not an event bus or execution scheduler.
// Factories still own their authority/privacy fences and native lifecycle.
export class RuntimeResourceScope {
  #resources=[]; #states=new Map(); #disposal=null; #closed=false;
  #next=0; #cleanup=Promise.resolve();
  checkpoint() { return this.#next; }
  #assertCanAcquire() {
    if(this.#closed) throw new Error('runtime_scope_stopped');
    if(this.#resources.some(entry=>this.#states.get(entry.name)?.reason==='disposal_failed'))
      throw new Error('runtime_scope_cleanup_failed');
  }
  starting(name) {
    this.#assertCanAcquire();
    if(this.#states.get(name)?.state==='operational') throw new Error('runtime_resource_already_started');
    this.#states.set(name,{state:'starting',reason:null});
  }
  own(name,resource,close) {
    this.#assertCanAcquire();
    if(this.#resources.some(entry=>entry.name===name)) throw new Error('runtime_resource_duplicate');
    if(typeof close!=='function') throw new TypeError('runtime_resource_disposer_required');
    this.#resources.push({name,order:this.#next++,close:()=>close(resource)});
    this.#states.set(name,{state:'operational',reason:null});
    return resource;
  }
  failed(name) { this.#states.set(name,{state:'failed',reason:'initialization_failed'}); }
  rollback(checkpoint=0) {
    // Serialize cleanup; retain ownership until a close actually succeeds.
    // Monotonic checkpoints remain valid when earlier closes failed.
    const cleanup=this.#cleanup.then(async()=>{
      const entries=this.#resources.filter(entry=>entry.order>=checkpoint).reverse();
      const failures=[];
      for(const entry of entries) {
        const {name,close}=entry;
        try {
          await close();
          this.#resources.splice(this.#resources.indexOf(entry),1);
          this.#states.set(name,{state:'stopped',reason:null});
        } catch {
          failures.push(name);
          this.#states.set(name,{state:'failed',reason:'disposal_failed'});
        }
      }
      return Object.freeze({failures:Object.freeze(failures)});
    });
    this.#cleanup=cleanup;
    return cleanup;
  }
  dispose() {
    if(!this.#disposal) {
      this.#closed=true;
      this.#disposal=this.rollback();
      const attempt=this.#disposal;
      attempt.then(result=>{
        if(result.failures.length && this.#disposal===attempt) this.#disposal=null;
      });
    }
    return this.#disposal;
  }
  snapshot() {
    return Object.freeze({state:this.#resources.some(entry=>this.#states.get(entry.name)?.reason==='disposal_failed')
      ?'failed':this.#closed?'stopped':'running',
      resources:Object.freeze(Object.fromEntries([...this.#states].map(([id,state])=>[id,Object.freeze({...state})]))),
      ownedResources:this.#resources.length});
  }
}

// Failed startup exposes only cleanup/diagnostics, never an executable runtime.
export function runtimeCleanupError(scope,failures,code='runtime_cleanup_failed') {
  const error=new Error(code);
  error.failures=Object.freeze([...failures]);
  error.cleanup=Object.freeze({snapshot:()=>scope.snapshot(),retry:()=>scope.dispose()});
  return error;
}

export function createMemoryKRuntimeComposition(config) {
  const scope=new RuntimeResourceScope();
  const requests=config.memoryK?.capabilities??{};
  // Independent production adapters follow in F/G/H/I/J/K/L/N. This owner
  // must never infer their readiness from methods or policy configuration.
  const requested=Object.keys(requests).length>0;
  return Object.freeze({scope,
    snapshot(available={},operation={}) {
      const policy=resolveMemoryKCapabilities({config,available});
      const lifecycle=scope.snapshot();
      return Object.freeze({lifecycle,policy,
        capabilities:Object.freeze(Object.fromEntries(MEMORY_K_CAPABILITIES.map(descriptor=>{
          const row=policy[descriptor.id];
          if(operation[descriptor.id])return [descriptor.id,Object.freeze({
            ...operation[descriptor.id],configurationExplicit:requested})];
          const storage=descriptor.id==='p2.sqlite'&&config.promotedCharacters?.storageMode==='sqlite'
            ?lifecycle.resources['p2.storage']:null;
          if(storage) return [descriptor.id,Object.freeze({requestedMode:'on',
            state:storage.state,effectiveMode:storage.state==='operational'?'on':storage.state==='stopped'?'off':null,
            operationalState:storage.state,reason:storage.reason,
            // Opening storage does not certify a timeline/source/privacy operation.
            configurationExplicit:requested})];
          const optional=descriptor.id.startsWith('memory.')||descriptor.id.startsWith('events.');
          const offEnforced=requested&&optional&&row.requestedMode==='off';
          // Mandatory source/authority and ordinary PS policy rows retain B's
          // unverified evidence state. A running transport is not source proof,
          // and lack of proof is not absent production wiring.
          const state=row.state==='blocked'?'blocked':offEnforced?'stopped':
            optional&&requested&&row.requestedMode!=='off'?'unavailable':
            row.requestedMode==='off'?'requested':row.state;
          return [descriptor.id,Object.freeze({requestedMode:row.requestedMode,
            state,effectiveMode:offEnforced?'off':null,operationalState:'unverified',
            reason:offEnforced?'optional_consumer_stopped':row.state==='blocked'?'dependency_blocked':
              optional&&requested&&row.requestedMode!=='off'?'independent_production_wiring_pending':
              row.requestedMode==='off'?'legacy_operation_unverified':row.reason,
            configurationExplicit:requested})];
        })))});
    },
  });
}

// Independent production adapters follow in later workstreams. Explicit
// requests cannot activate coupled legacy bundles as an incidental effect.
export function memoryKConsumersAllowed(config) {
  return Object.keys(config.memoryK?.capabilities??{}).length===0;
}
