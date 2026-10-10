// One in-flight original Core turn. All completion statuses are admitted by
// the independently checking native PS6 owner fiber; companion never promotes
// its own playback events or an untrusted turn ID into a delivery receipt.
const MAX_WAIT_BIND_MS=4000;
const MAX_WAIT_PLAYBACK_MS=120000;
export class DirectorPlaybackRegistry {
  constructor({onTimeout=()=>{}}={}) {
    this.entries=new Map();this.onTimeout=onTimeout;
  }
  begin(ticket,gates) {
    const id=ticket?.ticketId;
    if(typeof id!=='string' || this.entries.size!==0 ||
       !gates || typeof gates.hydrated!=='function' ||
       typeof gates.publication!=='function')return null;
    let boundResolve,terminalResolve;
    const bound=new Promise(resolve=>{boundResolve=resolve;});
    const terminal=new Promise(resolve=>{terminalResolve=resolve;});
    const entry={ticket,gates,identity:null,hydrated:false,published:false,started:false,
      finished:false,boundResolve,terminalResolve,bound,terminal};
    this.entries.set(id,entry);
    entry.bindingTimeout=setTimeout(()=>{
      // The most informative possible failure when original Core never
      // published a bound generation. Diagnostic only; fail as before.
      const stage=entry.hydrated?
        (entry.identity?'publication_missing':'binding_missing'):'hydration_missing';
      try{this.onTimeout(stage);}catch{}
      this.fail(id);
    },MAX_WAIT_BIND_MS);
    entry.bindingTimeout.unref?.();
    return entry;
  }
  entry(ticket){const e=this.entries.get(ticket?.ticketId);return e?.ticket===ticket?e:null;}
  hydration(ticket) {
    const e=this.entry(ticket);
    if(!e || e.hydrated || e.finished)return false;
    try {e.hydrated=e.gates.hydrated()===true;}catch{return false;}
    if(!e.hydrated)this.fail(ticket.ticketId);
    return e.hydrated;
  }
  identify(ticket,identity) {
    const e=this.entry(ticket);
    if(!e || !e.hydrated || e.identity || e.finished ||
       typeof identity?.pedId!=='string' || !identity.pedId ||
       typeof identity.turnId!=='string' || !identity.turnId ||
       !Number.isSafeInteger(identity.generationId) || identity.generationId<0 ||
       !Number.isSafeInteger(identity.sessionNonce) || identity.sessionNonce<=0)return false;
    e.identity=Object.freeze({...identity});return true;
  }
  publication(ticket){
    const e=this.entry(ticket);
    if(!e || !e.hydrated || !e.identity || e.published || e.finished)return false;
    let allowed=false;
    try {allowed=e.gates.publication()===true;}catch{}
    if(!allowed){this.fail(ticket.ticketId);return false;}
    e.published=true;clearTimeout(e.bindingTimeout);
    e.boundResolve(Object.freeze({tuple:e.identity,terminal:e.terminal}));
    e.playbackTimeout=setTimeout(()=>this.fail(ticket.ticketId),MAX_WAIT_PLAYBACK_MS);
    e.playbackTimeout.unref?.();
    return true;
  }
  onNativeStatus(id,status){
    const e=this.entries.get(id);
    if(!e || e.finished || !e.published)return false;
    if(status==='started' && !e.started){e.started=true;return true;}
    if(status==='completed' && e.started){
      e.finished=true;clearTimeout(e.playbackTimeout);
      e.terminalResolve(Object.freeze({type:'playback_ended',reason:'completed',
        wasInterrupted:false,hadAudio:true,playbackStarted:true}));
      return true;
    }
    if(status==='failed' || status==='completed') {this.fail(id);return true;}
    return false;
  }
  fail(id) {
    const e=this.entries.get(id);
    if(!e || e.finished)return;
    e.finished=true;clearTimeout(e.bindingTimeout);clearTimeout(e.playbackTimeout);
    e.boundResolve(null);
    e.terminalResolve(Object.freeze({type:'playback_ended',reason:'failed',
      wasInterrupted:true,hadAudio:false,playbackStarted:false}));
  }
  clear(id) {
    const e=this.entries.get(id);
    if(!e)return;
    this.fail(id);
    clearTimeout(e.bindingTimeout);clearTimeout(e.playbackTimeout);
    this.entries.delete(id);
  }
  reset(){for(const id of [...this.entries.keys()])this.clear(id);}
}
