// Original-turn actor ledger (the source behind D03's `originalActor` port).
//
// What it attests, and nothing more: for one exact Essential turn tuple
// {pedId, turnId, generationId, sessionNonce}, the native NPC ped that the
// ORIGINAL backend bound to that turn when the turn was created, read back
// from the original turn registry (`le` / `A.sessionsByPedId`) by the patched
// bridge at the original Xn generation binding. The caller supplies only an
// identity and the connection object; every recorded fact is pulled from the
// original registry, which refuses any identity that is not the current
// original OpenAI turn of the session the connection is registered for.
//
// Turn pedId provenance (pinned bundle 5d81de42…): `ib` (playerText) uses
// `Fr(A.activeActor.pedId || t.speaker.pedId || t.pedId)` and `lb` (micStart)
// uses `o4(t)`; both come from the native Core's submission message and are
// fixed by `Xi` -> `le.createTurn` (`jY`); `le` never changes a turn's pedId.
// The Core sends the native Ped handle (`Ped.Handle.ToString()`, the same key
// P1 EnrichActor/registration and the D02 owner sampler use), so only
// positive decimal handle strings are recorded.
//
// The ledger does NOT attest which character the ped is. Character binding is
// verified independently by P1 (fresh native owner proof for this exact ped at
// turn preparation) and D02 (authenticated native owner roster); D03 requires
// all three to agree. Special events, Director and system turns are recorded
// for completeness but never resolve as player turns (D-016).
const PED=/^[1-9][0-9]{0,9}$/;
const KEYS=Object.freeze(['pedId','turnId','generationId','sessionNonce']);
const PLAYER_SOURCES=new Set(['player_text','player_mic']);
const validIdentity=i=>!!i&&typeof i==='object'&&
  typeof i.pedId==='string'&&PED.test(i.pedId)&&
  typeof i.turnId==='string'&&i.turnId.length>0&&i.turnId.length<=128&&
  i.turnId.trim()===i.turnId&&
  Number.isSafeInteger(i.generationId)&&i.generationId>=0&&
  Number.isSafeInteger(i.sessionNonce)&&i.sessionNonce>=1;
const keyOf=i=>KEYS.map(k=>String(i[k])).join('\u0000');
const sessionKeyOf=i=>String(i.pedId)+'\u0000'+String(i.sessionNonce);
const same=(a,b)=>!!a&&!!b&&KEYS.every(k=>a[k]===b[k]);
const pick=i=>Object.freeze(Object.fromEntries(KEYS.map(k=>[k,i[k]])));

export function createOriginalTurnActorLedger({readOriginalTurn,maxEntries=128,
  now=()=>Date.now()}={}){
  if(typeof readOriginalTurn!=='function'||typeof now!=='function'||
     !Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>4096)
    throw new TypeError('original_turn_actor_ledger_ports_required');
  const entries=new Map();
  let sequence=0;
  const remember=(key,entry)=>{
    entries.delete(key);entries.set(key,entry);
    while(entries.size>maxEntries)entries.delete(entries.keys().next().value);
  };
  // Called synchronously from OpenAIConnection.beginTurn, which the patched
  // original Xn invokes after le.bindGeneration and the provider/session-nonce
  // metadata assignment, before any player input reaches the provider.
  function recordAtTurnCreation(identity,connection){
    if(!validIdentity(identity))return null;
    let facts;
    try{facts=readOriginalTurn(pick(identity),connection);}catch{return null;}
    if(!facts||typeof facts!=='object'||!same(facts,identity)||
       typeof facts.pedId!=='string'||!PED.test(facts.pedId)||
       typeof facts.source!=='string'||typeof facts.inputTranscript!=='string')
      return null;
    let typedInput=null;
    if(facts.source==='player_text'){
      const raw=facts.typed?.rawText;
      // The original ib adopts Fr(t.text) || "Hello, what are you doing here?".
      // Only the first branch is the player's own words: the trimmed raw Core
      // text must be non-empty and identical to the adopted transcript, and
      // the Core message must be an ordinary playerText (not testPrompt).
      const playerAuthored=facts.typed?.messageType==='playerText'&&
        typeof raw==='string'&&raw.trim()!==''&&raw.trim()===facts.inputTranscript;
      typedInput=Object.freeze({text:facts.inputTranscript,playerAuthored});
    }
    const entry=Object.freeze({identity:pick(identity),nativeActorPedId:facts.pedId,
      source:facts.source,typedInput,recordedAt:now(),sequence:++sequence});
    // A newer generation for the same native session supersedes every older
    // entry: the original backend no longer treats those turns as current.
    for(const [key,old] of entries)
      if(sessionKeyOf(old.identity)===sessionKeyOf(identity)&&
         old.identity.generationId<identity.generationId)entries.delete(key);
    remember(keyOf(identity),entry);
    return entry;
  }
  // D03 port. Echoes the requested character/alias only after the exact
  // identity resolves to a player turn recorded at original turn creation.
  function resolveAtTurnStart({identity,characterId,ownerAlias}={}){
    if(!validIdentity(identity))return null;
    const entry=entries.get(keyOf(identity));
    if(!entry||!PLAYER_SOURCES.has(entry.source)||!same(entry.identity,identity))
      return null;
    return Object.freeze({source:'original_core_actor_at_turn_start',
      identity:entry.identity,characterId,ownerAlias,
      nativeActorPedId:entry.nativeActorPedId,ledgerSequence:entry.sequence});
  }
  function factsFor(identity){
    if(!validIdentity(identity))return null;
    const entry=entries.get(keyOf(identity));
    return entry&&same(entry.identity,identity)?entry:null;
  }
  return Object.freeze({
    recordAtTurnCreation,resolveAtTurnStart,factsFor,
    retire(identity){if(validIdentity(identity))entries.delete(keyOf(identity));},
    retireSession(session={}){
      if(typeof session?.pedId!=='string'||!Number.isSafeInteger(session.sessionNonce))return;
      const key=sessionKeyOf(session);
      for(const [k,entry] of entries)if(sessionKeyOf(entry.identity)===key)entries.delete(k);
    },
    clear(){entries.clear();},
    get size(){return entries.size;},
  });
}
