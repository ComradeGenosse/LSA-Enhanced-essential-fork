// Runtime-local, monotone revocation. Administration always keeps the original
// P2 port; optional producers/readers receive this fenced view of that SAME port.
export function createLearnedMemoryPause({paused=false}={}) {
  let revoked=paused,epoch=0,notificationFailures=0;
  const listeners=new Set();
  const current=stamp=>!revoked&&stamp===epoch;
  const assert=stamp=>{if(!current(stamp))throw Error('learned_memory_paused');};
  const wrap=target=>target&&new Proxy(target,{
    get(object,key) {
      const value=Reflect.get(object,key,object);
      if(typeof value!=='function')return value;
      return (...args)=>{
        const stamp=epoch;assert(stamp);
        // P2 executes these synchronous callbacks inside its serialized queue.
        // Guard both admission and actual execution, including nested foundation
        // methods. No extra SQLite connection, transaction, writer or scheduler.
        const guarded=args.map(arg=>typeof arg==='function'?(...inner)=>{
          assert(stamp);
          const result=arg(...inner.map(item=>item&&typeof item==='object'?wrap(item):item));
          assert(stamp);return result;
        }:arg);
        const result=typeof object.withOptionalMemoryFence==='function'
          ?object.withOptionalMemoryFence(()=>assert(stamp),()=>value.apply(object,guarded))
          :value.apply(object,guarded);
        if(result&&typeof result.then==='function')return result.then(data=>{assert(stamp);return data;});
        assert(stamp);return result;
      };
    }
  });
  return Object.freeze({
    get paused(){return revoked;},
    stamp:()=>epoch,current,
    optionalStore:wrap,
    subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
    pause(){
      if(!revoked){revoked=true;++epoch;for(const fn of listeners){try{fn();}catch{++notificationFailures;}}}
      return Object.freeze({paused:revoked,epoch,notificationFailures,resumeRequiresRestart:true});
    },
  });
}

export function withLearnedMemoryPause(snapshot,pause) {
  if(!pause.paused)return snapshot;
  return Object.freeze({...snapshot,capabilities:Object.freeze(Object.fromEntries(
    Object.entries(snapshot.capabilities).map(([id,row])=>[
      id,(id.startsWith('memory.')&&id!=='memory.inspector'||id.startsWith('events.'))
        ?Object.freeze({...row,effectiveMode:'off',state:'paused',operationalState:'paused',reason:'learned_memory_paused'})
        :row]))) });
}
